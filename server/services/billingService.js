// Monthly billing with the database: the charge and the classes of each month,
// the first charge of a new student, and what happens when a month is not paid.
// The rules themselves are in domain/billing.js, domain/monthly.js and domain/pricing.js.
const { Op } = require('sequelize');
const { sequelize, User, City, FixedSchedule, Lesson, Payment, PaymentAdjustment, Cycle, TeacherRoom } = require('../models');
const { checkMakeupTarget } = require('../domain/lessons');
const { checkTeacherPresent } = require('../domain/absences');
const { findDatedConflict } = require('../domain/conflicts');
const { assertOk } = require('../domain/errors');
const { runBookingTransaction } = require('./bookingTransaction');
const { loadScheduleContext } = require('./scheduleContext');
const { ROLES, LESSON_STATUS, LESSON_KIND } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { resolvePrices, resolvePaymentText } = require('../domain/pricing');
const { monthlyClassPlan, occurrencesInMonth } = require('../domain/monthly');
const {
    PAYMENT_TYPE, PAYMENT_STATUS, monthlyCharge, paymentStanding, unpaidClassesDebt, paymentDeadline, singleClassesCharge,
} = require('../domain/billing');
const {
    toUtc, addMinutes, addDays, localDate, monthOf, firstDayOfMonth, lastDayOfMonth, formatDay, formatMonth, formatInstant,
} = require('../domain/time');
const { formatCOP } = require('../domain/money');
const { getSettings } = require('./settingsService');
const { createPayment } = require('./paymentService');
const { createNotice } = require('./noticeService');
const { logAudit } = require('./audit');

const plain = (row) => row.get({ plain: true });
const MONTH_CHARGES = [PAYMENT_TYPE.MENSUALIDAD, PAYMENT_TYPE.PROPORCIONAL];

const academyIds = async () =>
    (await User.findAll({ where: { role: ROLES.ACADEMY, active: true }, attributes: ['id'] })).map(u => u.id);

/** The student's city and the prices they pay (only the academy sets them, per city). */
const pricesForStudent = async (student, { transaction } = {}) => {
    const city = student.cityId && await City.findByPk(student.cityId, { transaction });
    if (!city) throw new DomainError('sin_ciudad', `${student.name} no tiene ciudad asignada.`);
    return { city, prices: resolvePrices({ city }) };
};

/** Text with the academy's bank account / Nequi for the student's city, shown on the payment screen. */
const paymentTextFor = async (student, { transaction } = {}) => {
    const { city } = await pricesForStudent(student, { transaction });
    return resolvePaymentText({ city });
};

// The charge that covers a month (mensualidad or proporcional), if any is still valid
const monthChargeOf = (studentId, period, { transaction } = {}) =>
    Payment.findOne({
        where: { studentId, period, type: MONTH_CHARGES, status: { [Op.ne]: PAYMENT_STATUS.ANULADO } },
        order: [['createdAt', 'DESC']],
        transaction,
    });

/**
 * Creates the regular lessons of the given dates for a fixed schedule, skipping
 * dates where the student already has a lesson at that time. Returns the lessons created.
 */
const createLessonsOn = async ({ fixed, dates, transaction }) => {
    const created = [];
    for (const date of dates) {
        const startsAt = toUtc(date, fixed.startTime);
        const exists = await Lesson.findOne({ where: { studentId: fixed.studentId, startsAt }, transaction });
        if (exists) continue;
        created.push(await Lesson.create({
            studentId: fixed.studentId,
            teacherId: fixed.teacherId,
            roomId: fixed.roomId,
            startsAt,
            endsAt: addMinutes(startsAt, fixed.durationMinutes),
            kind: LESSON_KIND.REGULAR,
            status: LESSON_STATUS.PROGRAMADA,
            period: monthOf(date),
        }, { transaction }));
    }
    return created;
};

// Fixed schedules of a student that run at some point of a month
const fixedSchedulesInMonth = (studentId, period, { transaction } = {}) =>
    FixedSchedule.findAll({
        where: {
            studentId,
            validFrom: { [Op.lte]: lastDayOfMonth(period) },
            [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: firstDayOfMonth(period) } }],
        },
        transaction,
    });

/**
 * The classes of a month from the student's fixed schedules (the 5th week is left for make-ups).
 * fromDate: only from that day on; after: only classes that start after that instant.
 */
const generateMonthLessons = async ({ studentId, period, settings, transaction, fromDate = null, after = null }) => {
    const created = [];
    for (const fixed of (await fixedSchedulesInMonth(studentId, period, { transaction })).map(plain)) {
        const { classes } = monthlyClassPlan({ period, fixed, coversAll: settings.mensualidad_cubre_todas_las_clases });
        const dates = classes
            .filter(d => !fromDate || d >= fromDate)
            .filter(d => !after || toUtc(d, fixed.startTime) > new Date(after));
        created.push(...await createLessonsOn({ fixed, dates, transaction }));
    }
    return created;
};

// Classes of a month that came from a weekly time (single classes do not count)
const weeklyLessonsInMonth = (studentId, period, { transaction } = {}) =>
    Lesson.count({ where: { studentId, period, paymentId: null, kind: LESSON_KIND.REGULAR }, transaction });

/**
 * The mensualidad of a month for one student, with the discounts still pending
 * (classes the teacher did not make up in time), and the classes of the month.
 * Idempotent: a month that already has its charge is left alone.
 * With `transaction` it runs inside the caller's transaction.
 * withLessons: the classes are created with the charge only for a student who
 * keeps coming (the automatic charge of day 1: they keep their classes from day 1
 * to the deadline). Otherwise the classes come when the academy approves the payment.
 */
const chargeMonth = async ({ student, period, actor = null, now = new Date(), transaction: outer = null, withLessons = true }) =>
    (outer ? (fn) => fn(outer) : (fn) => sequelize.transaction(fn))(async (transaction) => {
        if (await monthChargeOf(student.id, period, { transaction })) return null;
        const settings = await getSettings({ transaction });
        const { city, prices } = await pricesForStudent(student, { transaction });
        const discounts = (await PaymentAdjustment.findAll({
            where: { studentId: student.id, kind: 'descuento_clase_no_repuesta', appliedPaymentId: null },
            transaction,
        })).map(plain);
        const charge = monthlyCharge({ period, prices, settings, discounts, today: localDate(now) });
        const payment = await createPayment({
            studentId: student.id, cityId: city.id, teacherId: student.teacherId, ...charge,
        }, { actor, transaction });
        if (discounts.length) {
            await PaymentAdjustment.update({ appliedPaymentId: payment.id }, { where: { id: discounts.map(d => d.id) }, transaction });
        }
        const lessons = withLessons ? await generateMonthLessons({ studentId: student.id, period, settings, transaction }) : [];
        await createNotice({
            category: 'mensualidad',
            title: `Mensualidad de ${formatMonth(period)}`,
            message: `Tu mensualidad de ${formatMonth(period)} es de ${formatCOP(payment.amount)}`
                + (discounts.length ? ` (con ${formatCOP(prices.monthlyFee - payment.amount)} de descuento)` : '')
                + `. Puedes pagar hasta el ${formatDay(payment.dueDate)}.`,
            recipientIds: [student.id],
            meta: { paymentId: payment.id },
        }, { transaction });
        await logAudit({ entityType: 'student', entityId: student.id, action: 'mes_generado', details: { period, lessons: lessons.length, at: new Date(now) } }, { transaction });
        return { payment: plain(payment), lessons: lessons.length };
    });

/**
 * Day 1 (and every run until the payment deadline day; it is idempotent): every active student whose
 * weekly class runs from the start of the month gets the month's charge and
 * classes. Left out: a student who starts mid-month (their first charge is the
 * proporcional, made when the teacher gives them the time), one whose weekly
 * class already ended, one still in a 4-week cycle, and a month that was
 * already charged (even if that charge was annulled for not paying).
 */
const runMonthlyBilling = async (now = new Date()) => {
    const today = localDate(now);
    const period = monthOf(today);
    // Automatic only at the start of the month (until the payment deadline). Later in
    // the month the academy charges by hand, so nobody gets a charge that is already late.
    const settings = await getSettings();
    if (Number(today.slice(8, 10)) > settings.dia_limite_pago) return 0;
    const fixed = (await FixedSchedule.findAll({
        where: {
            validFrom: { [Op.lte]: lastDayOfMonth(period) },
            [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }],
        },
    })).map(plain).filter(f => f.validFrom <= occurrencesInMonth(period, f.weekday)[0]);
    const studentIds = [...new Set(fixed.map(f => f.studentId))];
    const charged = new Set((await Payment.findAll({
        where: { studentId: studentIds, period, type: MONTH_CHARGES }, attributes: ['studentId'],
    })).map(p => p.studentId));
    const inCycle = new Set((await Cycle.findAll({
        where: { studentId: studentIds, status: 'activo', endDate: { [Op.gte]: firstDayOfMonth(period) } }, attributes: ['studentId'],
    })).map(c => c.studentId));
    const students = await User.findAll({
        where: { id: studentIds.filter(id => !charged.has(id) && !inCycle.has(id)), role: ROLES.STUDENT, active: true },
    });
    let count = 0;
    for (const student of students) {
        // One student's problem (e.g. no city) must not stop everyone else's charge
        try {
            if (await chargeMonth({ student, period, now })) count++;
        } catch (error) {
            console.error(`Cobro mensual de ${student.name} (${period}):`, error.message);
        }
    }
    return count;
};

/** Clase suelta charges for classes taken without paying that are still unpaid: they must be paid before getting a new time. */
const unpaidDebts = (studentId, { transaction } = {}) =>
    Payment.findAll({
        where: { studentId, type: PAYMENT_TYPE.CLASE_SUELTA, status: [PAYMENT_STATUS.POR_PAGAR, PAYMENT_STATUS.RECHAZADO, PAYMENT_STATUS.EN_REVISION] },
        transaction,
    }).then(rows => rows.filter(r => r.calculation?.debt));

/**
 * The teacher gives a student their weekly time. The teacher never creates
 * charges: the academy does (mensualidad, clases sueltas). The weekly time
 * fills with classes the months the academy already charged AND approved (this
 * month or later) that still have none: all the classes of that month, from its
 * first week on (the date the teacher tapped only sets the day and the hour).
 * A charged month whose payment is not approved yet is kept: its classes come
 * when the academy approves it (fillApprovedMonth). Without a charge, the time
 * is kept and the classes come when the academy charges and the payment is approved.
 * Returns { validFrom, months, waiting } (approved months to fill now, charged
 * months still waiting for the payment), or throws 'deuda_pendiente'.
 */
const planWeeklyTime = async ({ student, weekday, startTime, tappedDate, now, transaction }) => {
    const debts = await unpaidDebts(student.id, { transaction });
    if (debts.length) {
        const total = debts.reduce((sum, d) => sum + d.amount, 0);
        throw new DomainError(
            'deuda_pendiente',
            `${student.name} tiene ${formatCOP(total)} pendientes de clases que tomó sin pagar. Primero debe pagarlos; luego le puedes asignar su horario.`,
            409
        );
    }
    const thisMonth = monthOf(localDate(now));
    const charged = await Payment.findAll({
        where: { studentId: student.id, type: MONTH_CHARGES, status: { [Op.ne]: PAYMENT_STATUS.ANULADO }, period: { [Op.gte]: thisMonth } },
        order: [['period', 'ASC']],
        transaction,
    });
    const months = [];
    const waiting = [];
    for (const period of [...new Set(charged.map(p => p.period))]) {
        // Classes from a weekly time already exist that month: nothing to fill
        if (await weeklyLessonsInMonth(student.id, period, { transaction })) continue;
        const approved = charged.some(p => p.period === period && p.status === PAYMENT_STATUS.APROBADO);
        (approved ? months : waiting).push(period);
    }
    const toFill = [...months, ...waiting].sort();
    if (!toFill.length) return { validFrom: tappedDate, months, waiting };
    // From the first class of the first charged month that is still ahead
    const first = occurrencesInMonth(toFill[0], weekday).find(d => toUtc(d, startTime) > new Date(now));
    return { validFrom: first || tappedDate, months, waiting };
};

/**
 * The academy approved a payment. A month charge (mensualidad / proporcional)
 * brings the month's classes from the weekly time, if it still has none (only
 * the ones still ahead). Single classes can now be booked by the teacher.
 * The teacher is told either way. Runs inside the approval's transaction.
 */
const afterPaymentApproved = async ({ payment, actor, now = new Date(), transaction }) => {
    const student = await User.findByPk(payment.studentId, { transaction });
    if (!student) return { lessons: [] };
    let lessons = [];
    if (MONTH_CHARGES.includes(payment.type) && payment.period
        && !await weeklyLessonsInMonth(student.id, payment.period, { transaction })) {
        const settings = await getSettings({ transaction });
        lessons = await generateMonthLessons({ studentId: student.id, period: payment.period, settings, transaction, after: now });
        if (lessons.length) {
            await logAudit({
                entityType: 'student', entityId: student.id, action: 'clases_por_pago_aprobado', actorId: actor?.id,
                details: { paymentId: payment.id, period: payment.period, lessons: lessons.length },
            }, { transaction });
        }
    }
    const teacherNotice = (() => {
        if (lessons.length) {
            return {
                title: 'Pago aprobado: clases en tu agenda',
                message: `La academia aprobó el pago de ${student.name} de ${formatMonth(payment.period)}. Sus ${lessons.length} clase(s) del mes ya están en tu agenda.`,
            };
        }
        if (payment.type === PAYMENT_TYPE.CLASE_SUELTA && !payment.calculation?.debt) {
            return {
                title: 'Pago aprobado: ya puedes agendar',
                message: `La academia aprobó el pago de las clases sueltas de ${student.name}. Ya puedes agendarlas en Mi agenda (Por agendar).`,
            };
        }
        return null;
    })();
    if (teacherNotice && student.teacherId) {
        await createNotice({
            category: 'pago_confirmado', ...teacherNotice, recipientIds: [student.teacherId], authorId: actor?.id || null, meta: { paymentId: payment.id },
        }, { transaction });
    }
    return { lessons: lessons.map(plain) };
};

/** After the weekly time is created: the classes of the charged months that had none. */
const fillChargedMonths = async ({ student, months, validFrom, transaction }) => {
    const settings = await getSettings({ transaction });
    const lessons = [];
    for (const period of months) {
        lessons.push(...await generateMonthLessons({ studentId: student.id, period, settings, transaction, fromDate: validFrom }));
    }
    return lessons;
};
// Ends the student's weekly classes from today: the time is free for someone else
const releaseFixedSchedules = async (studentId, { now, transaction }) => {
    const today = localDate(now);
    const current = await FixedSchedule.findAll({
        where: { studentId, [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }] },
        transaction,
    });
    for (const fixed of current) {
        if (fixed.validFrom >= today) await fixed.destroy({ transaction });
        else await fixed.update({ validTo: addDays(today, -1) }, { transaction });
    }
    return current.length;
};

/**
 * A month (or first charge) not paid by its deadline: the charge is annulled,
 * the student's time is freed (weekly classes end, upcoming classes are removed)
 * and the classes already taken that month become clase suelta debts.
 */
const releaseUnpaid = async ({ payment, now }) =>
    sequelize.transaction(async (transaction) => {
        const row = await Payment.findByPk(payment.id, { transaction });
        if (![PAYMENT_STATUS.POR_PAGAR, PAYMENT_STATUS.RECHAZADO].includes(row.status)) return null;
        const student = await User.findByPk(row.studentId, { transaction });
        const { city, prices } = await pricesForStudent(student, { transaction });

        await row.update({ status: PAYMENT_STATUS.ANULADO }, { transaction });
        await logAudit({
            entityType: 'payment', entityId: row.id, action: 'vencer_pago', fromStatus: payment.status, toStatus: PAYMENT_STATUS.ANULADO,
            details: { deadline: paymentDeadline(plain(row), await getSettings({ transaction })) },
        }, { transaction });

        // Classes taken in that month before losing the time
        const from = toUtc(firstDayOfMonth(row.period));
        const taken = (await Lesson.findAll({
            where: { studentId: student.id, status: LESSON_STATUS.TOMADA, startsAt: { [Op.gte]: from, [Op.lt]: new Date(now) } },
            transaction,
        })).map(plain);
        const debts = [];
        for (const charge of unpaidClassesDebt({ takenLessons: taken, prices })) {
            if (await Payment.findOne({ where: { lessonId: charge.lessonId }, transaction })) continue;
            debts.push(await createPayment({
                studentId: student.id, cityId: city.id, teacherId: student.teacherId, ...charge,
                calculation: { ...charge.calculation, debt: true },
            }, { transaction }));
        }

        await releaseFixedSchedules(student.id, { now, transaction });
        // Upcoming classes are removed, except a clase suelta paid apart (it is its own charge)
        const upcoming = await Lesson.findAll({
            where: { studentId: student.id, status: LESSON_STATUS.PROGRAMADA, startsAt: { [Op.gt]: new Date(now) } },
            transaction,
        });
        const withOwnCharge = new Set((await Payment.findAll({
            where: { lessonId: upcoming.map(l => l.id) }, attributes: ['lessonId'], transaction,
        })).map(p => p.lessonId));
        const upcomingIds = upcoming.map(l => l.id).filter(id => !withOwnCharge.has(id));
        if (upcomingIds.length) {
            await Lesson.update({ originalLessonId: null }, { where: { originalLessonId: upcomingIds }, transaction });
            await Lesson.destroy({ where: { id: upcomingIds }, transaction });
        }
        await logAudit({
            entityType: 'student', entityId: student.id, action: 'horario_liberado_por_no_pago',
            details: { paymentId: row.id, removedLessons: upcomingIds.length, debts: debts.length },
        }, { transaction });

        const debtTotal = debts.reduce((sum, d) => sum + d.amount, 0);
        await createNotice({
            category: 'horario_liberado',
            title: 'Tu horario quedó libre',
            message: `No registramos el pago de ${formatMonth(row.period)} a tiempo, así que tu horario quedó libre y ya no puedes agendar.`
                + (debtTotal ? ` Las clases que tomaste este mes quedan pendientes de pago (${formatCOP(debtTotal)}).` : '')
                + ' Si quieres volver, comunícate con la academia y te asignamos un horario según lo que haya disponible.',
            recipientIds: [student.id],
            meta: { paymentId: row.id },
        }, { transaction });
        await createNotice({
            category: 'horario_liberado',
            title: 'Horario liberado por falta de pago',
            message: `${student.name} no pagó ${formatMonth(row.period)} a tiempo: su horario quedó libre`
                + (upcomingIds.length ? ` y se quitaron sus ${upcomingIds.length} clase(s) siguientes` : '') + '.'
                + (debtTotal ? ` Debe ${formatCOP(debtTotal)} de clases tomadas sin pagar.` : ''),
            recipientIds: [student.teacherId, ...await academyIds()],
            meta: { paymentId: row.id, studentId: student.id },
        }, { transaction });
        return { paymentId: row.id, removedLessons: upcomingIds.length, debts: debts.length };
    });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SINGLE_CLASSES = 10;

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Classes of a single-class charge already booked, and how many are left
const singleClassesLeft = async (payment, { transaction } = {}) => {
    const booked = await Lesson.count({ where: { paymentId: payment.id }, transaction });
    return { booked, left: Math.max(0, (payment.calculation?.classes || 0) - booked) };
};

/**
 * One class of a single-class charge on a date and time (by the teacher, or by
 * the academy when it already agreed the date with the family). It must be in
 * the charge's month, in a room of the teacher, free, and with time left.
 */
const placeSingleClass = async ({ student, payment, roomId, startsAt, actor, now, transaction, ctx = null }) => {
    const settings = await getSettings({ transaction });
    const start = new Date(startsAt);
    const end = addMinutes(start, settings.duracion_clase_minutos);
    if (monthOf(localDate(start)) !== payment.period) {
        throw new DomainError('fuera_del_mes', `Estas clases sueltas son de ${formatMonth(payment.period)}: agéndala en ese mes.`);
    }
    const assigned = await TeacherRoom.findOne({ where: { teacherId: student.teacherId, roomId }, transaction });
    if (!assigned) throw new DomainError('salon_no_asignado', 'Ese salón no está asignado al profesor.');
    assertOk(checkMakeupTarget({ startsAt: start, endsAt: end, mode: 'suelta', settings, now }));
    const context = ctx || await loadScheduleContext({
        roomIds: [roomId], teacherIds: [student.teacherId], studentIds: [student.id], from: start, to: end,
    }, { transaction, now });
    assertOk(checkTeacherPresent({ absences: context.absences, teacherId: student.teacherId, startsAt: start }));
    const conflict = findDatedConflict({ startsAt: start, endsAt: end, roomId, teacherId: student.teacherId, studentId: student.id }, context);
    if (conflict) throw new DomainError(`choque_${conflict.type}`, conflict.message, 409, conflict);
    const lesson = await Lesson.create({
        studentId: student.id, teacherId: student.teacherId, roomId, startsAt: start, endsAt: end,
        kind: LESSON_KIND.REGULAR, status: LESSON_STATUS.PROGRAMADA, period: payment.period, paymentId: payment.id,
        changedById: actor.id, changedAt: new Date(now),
    }, { transaction });
    context.lessons.push(plain(lesson));
    return plain(lesson);
};

/**
 * The academy gives a student `count` single classes of a month: one charge
 * (one receipt) for all of them, never more than the monthly fee. The teacher
 * books them in their agenda ("Por agendar"). If the academy already agreed
 * some dates with the family it can place them now (classes: [{ date, startTime, roomId }]).
 * Returns { payment, lessons, left }.
 */
const bookSingleClasses = async ({ studentId, period, count, classes = [], actor, now = new Date() }) => {
    const total = Number(count) || classes.length;
    if (!Number.isInteger(total) || total < 1) throw new DomainError('sin_clases', 'Indica cuántas clases sueltas.');
    if (total > MAX_SINGLE_CLASSES) throw new DomainError('demasiadas_clases', `Puedes dar hasta ${MAX_SINGLE_CLASSES} clases sueltas a la vez.`);
    if (classes.length > total) throw new DomainError('demasiadas_fechas', 'Hay más fechas que clases.');
    for (const c of classes) {
        if (!DATE_PATTERN.test(c.date || '') || !TIME_PATTERN.test(c.startTime || '') || !c.roomId) {
            throw new DomainError('clase_invalida', 'Cada fecha necesita día, hora y salón.');
        }
    }
    const month = period || (classes[0] && monthOf(classes[0].date));
    if (!PERIOD_PATTERN.test(month || '')) throw new DomainError('mes_invalido', 'Indica el mes de las clases sueltas.');
    if (month < monthOf(localDate(now))) throw new DomainError('mes_pasado', 'Ese mes ya pasó.');

    const student = await User.findOne({ where: { id: studentId, role: ROLES.STUDENT, active: true } });
    if (!student) throw new DomainError('estudiante_invalido', 'El estudiante no existe.', 404);
    if (!student.teacherId) throw new DomainError('sin_profesor', `Primero asígnale un profesor a ${student.name}.`);
    const roomIds = [...new Set(classes.map(c => c.roomId))];

    return runBookingTransaction({ roomIds, userIds: [student.teacherId, student.id] }, async (transaction) => {
        const settings = await getSettings({ transaction });
        const { city, prices } = await pricesForStudent(student, { transaction });
        const charge = singleClassesCharge({ count: total, period: month, prices, settings, today: localDate(now) });
        const payment = await createPayment({ studentId: student.id, cityId: city.id, teacherId: student.teacherId, ...charge }, { actor, transaction });

        const slots = classes.map(c => toUtc(c.date, c.startTime)).sort((a, b) => a - b);
        const ctx = slots.length ? await loadScheduleContext({
            roomIds, teacherIds: [student.teacherId], studentIds: [student.id],
            from: slots[0], to: addMinutes(slots[slots.length - 1], settings.duracion_clase_minutos),
        }, { transaction, now }) : null;
        const lessons = [];
        for (const c of [...classes].sort((a, b) => toUtc(a.date, a.startTime) - toUtc(b.date, b.startTime))) {
            lessons.push(await placeSingleClass({
                student, payment: plain(payment), roomId: c.roomId, startsAt: toUtc(c.date, c.startTime), actor, now, transaction, ctx,
            }));
        }
        const left = total - lessons.length;
        const what = total === 1 ? 'una clase suelta' : `${total} clases sueltas`;
        const placed = lessons.length ? ` Fechas: ${lessons.map(l => formatInstant(l.startsAt)).join('; ')}.` : '';
        await createNotice({
            category: 'clases_sueltas',
            title: total === 1 ? 'Clase suelta' : 'Clases sueltas',
            message: `La academia te dio ${what} de ${formatMonth(month)} por ${formatCOP(payment.amount)}, en un solo pago. Puedes pagar hasta el ${formatDay(payment.dueDate)}.`
                + placed + (left ? ` Tu profesor te avisará ${left === total ? 'las fechas' : 'las demás fechas'}.` : ''),
            recipientIds: [student.id],
            authorId: actor.id,
            meta: { paymentId: payment.id },
        }, { transaction });
        await createNotice({
            category: 'clases_sueltas',
            title: 'Clases sueltas por agendar',
            message: `La academia le dio a ${student.name} ${what} de ${formatMonth(month)}.` + placed
                + (left ? ` Agenda ${left === 1 ? 'la que falta' : `las ${left} que faltan`} en Mi agenda.` : ''),
            recipientIds: [student.teacherId],
            authorId: actor.id,
            meta: { paymentId: payment.id },
        }, { transaction });
        return { payment: plain(payment), lessons, left };
    });
};

/** The teacher (or the academy) books one of the single classes the academy gave. */
const scheduleSingleClass = async ({ paymentId, actor, roomId, startsAt, now = new Date() }) => {
    const draft = await Payment.findByPk(paymentId);
    if (!draft) throw new DomainError('pago_no_encontrado', 'No se encontraron esas clases sueltas.', 404);
    return runBookingTransaction({ roomIds: [roomId], userIds: [draft.studentId] }, async (transaction) => {
        const payment = await Payment.findByPk(paymentId, { transaction });
        const student = await User.findByPk(payment.studentId, { transaction });
        if (!student || !student.active || !student.teacherId) throw new DomainError('estudiante_invalido', 'El estudiante no está activo o no tiene profesor.');
        if (!(actor.role === ROLES.ACADEMY || (actor.role === ROLES.TEACHER && actor.id === student.teacherId))) {
            throw new DomainError('sin_permiso', 'Solo el profesor del estudiante (o la academia) agenda estas clases.', 403);
        }
        if (payment.type !== PAYMENT_TYPE.CLASE_SUELTA || payment.calculation?.debt || payment.status === PAYMENT_STATUS.ANULADO) {
            throw new DomainError('no_es_clase_suelta', 'Ese cobro no es de clases sueltas por agendar.');
        }
        // The teacher books them only once the academy checked the payment
        if (actor.role === ROLES.TEACHER && payment.status !== PAYMENT_STATUS.APROBADO) {
            throw new DomainError(
                'pago_sin_aprobar',
                `La academia todavía no ha aprobado el pago de las clases sueltas de ${student.name}. Podrás agendarlas cuando lo apruebe.`,
                409
            );
        }
        const { left } = await singleClassesLeft(payment, { transaction });
        if (!left) throw new DomainError('clases_completas', 'Ya están agendadas todas las clases sueltas que dio la academia.', 409);
        const lesson = await placeSingleClass({ student, payment: plain(payment), roomId, startsAt, actor, now, transaction });
        await createNotice({
            category: 'clase_agendada',
            title: 'Clase suelta agendada',
            message: `Tu clase suelta quedó para el ${formatInstant(lesson.startsAt)}.`,
            recipientIds: [student.id],
            authorId: actor.id,
            meta: { lessonId: lesson.id },
        }, { transaction });
        return { lesson, left: left - 1 };
    });
};

/** Single classes the academy gave and the teacher still has to book (a teacher sees their students'). */
const pendingSingleClasses = async ({ actor }) => {
    const payments = await Payment.findAll({
        where: { type: PAYMENT_TYPE.CLASE_SUELTA, status: { [Op.ne]: PAYMENT_STATUS.ANULADO } },
        include: [{ model: User, as: 'student', attributes: ['id', 'name', 'teacherId', 'active'] }],
        order: [['period', 'ASC'], ['createdAt', 'ASC']],
    });
    const result = [];
    for (const payment of payments) {
        if (payment.calculation?.debt || !payment.student?.active) continue;
        if (actor.role === ROLES.TEACHER && payment.student.teacherId !== actor.id) continue;
        const { booked, left } = await singleClassesLeft(payment);
        if (!left) continue;
        result.push({
            paymentId: payment.id, studentId: payment.studentId, studentName: payment.student.name, period: payment.period,
            total: payment.calculation.classes, booked, left, paymentStatus: payment.status,
        });
    }
    return result;
};
/**
 * The academy charges a mensualidad by hand: this month's or next month's
 * (e.g. at the start of the month, or ahead for someone who starts next month).
 * The classes come from the weekly time once the academy approves the payment.
 */
const chargeMonthByHand = async ({ studentId, period: requested = null, actor, now = new Date() }) => {
    const student = await User.findOne({ where: { id: studentId, role: ROLES.STUDENT, active: true } });
    if (!student) throw new DomainError('estudiante_invalido', 'El estudiante no existe.', 404);
    const thisMonth = monthOf(localDate(now));
    const nextMonth = monthOf(addDays(lastDayOfMonth(thisMonth), 1));
    const period = requested || thisMonth;
    if (![thisMonth, nextMonth].includes(period)) {
        throw new DomainError('mes_invalido', 'Solo se puede cobrar la mensualidad de este mes o la del próximo.');
    }
    if (await monthChargeOf(student.id, period)) {
        throw new DomainError('mes_ya_cobrado', `${student.name} ya tiene el cobro de ${formatMonth(period)}.`, 409);
    }
    // The classes come when the academy approves this payment, not with the charge
    const result = await chargeMonth({ student, period, actor, now, withLessons: false });
    if (!result) throw new DomainError('mes_ya_cobrado', `${student.name} ya tiene el cobro de ${formatMonth(period)}.`, 409);
    return result;
};

/** From the day after the deadline: unpaid months free the student's time. */
const enforcePaymentDeadlines = async (now = new Date()) => {
    const settings = await getSettings();
    const open = await Payment.findAll({
        where: { type: MONTH_CHARGES, status: [PAYMENT_STATUS.POR_PAGAR, PAYMENT_STATUS.RECHAZADO], dueDate: { [Op.lt]: localDate(now) } },
    });
    let released = 0;
    for (const payment of open) {
        if (!paymentStanding({ payment: plain(payment), now, settings }).blocks) continue;
        try {
            if (await releaseUnpaid({ payment: plain(payment), now })) released++;
        } catch (error) {
            console.error(`Plazo de pago ${payment.id}:`, error.message);
        }
    }
    return released;
};

/** Does an unpaid month keep the student from booking? (a class in `period`) */
const isBlockedByPayment = async (studentId, period, { now = new Date(), transaction } = {}) => {
    const payment = await Payment.findOne({
        where: { studentId, period, type: MONTH_CHARGES },
        order: [['createdAt', 'DESC']],
        transaction,
    });
    if (!payment) return false;
    if (payment.status === PAYMENT_STATUS.ANULADO) return true;
    return paymentStanding({ payment: plain(payment), now, settings: await getSettings({ transaction }) }).blocks;
};

module.exports = {
    pricesForStudent, paymentTextFor, monthChargeOf, generateMonthLessons, createLessonsOn, chargeMonth, runMonthlyBilling,
    planWeeklyTime, fillChargedMonths, afterPaymentApproved, unpaidDebts, enforcePaymentDeadlines, releaseUnpaid, isBlockedByPayment,
    bookSingleClasses, scheduleSingleClass, pendingSingleClasses, singleClassesLeft, chargeMonthByHand,
};
