// Cycles ("mensualidades"): creation, payment review and activation.
// A cycle generates its lessons only once its payment is confirmed.
const { Op } = require('sequelize');
const { sequelize, Lesson, Cycle, FixedSchedule, ClosureDay, User } = require('../models');
const { CYCLE_STATUS, PAYMENT_STATUS, CYCLE_PLAN, ROLES } = require('../domain/constants');
const { DomainError, assertOk } = require('../domain/errors');
const { canManageStudentBookings } = require('../domain/permissions');
const { computeEndDate, generateCycleLessons, nextCycleStartDate, planDefaults } = require('../domain/cycles');
const { localDate, toUtc, weekdayOf, addDays } = require('../domain/time');
const { runBookingTransaction } = require('./bookingTransaction');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./audit');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OPEN_STATUSES = [CYCLE_STATUS.PENDIENTE_PAGO, CYCLE_STATUS.ACTIVO];

const plain = (row) => row.get({ plain: true });

// Earliest class start on a day, from the fixed schedules
const firstSlotOn = (fixedSchedules, date) => {
    const starts = fixedSchedules
        .filter(f => f.weekday === weekdayOf(date))
        .map(f => toUtc(date, f.startTime))
        .sort((a, b) => a - b);
    return starts[0] || null;
};

/**
 * Suggested start for a student's next cycle: the first class day after the
 * last open cycle (or from today).
 */
const suggestStartDate = async (studentId, { transaction, now = new Date() } = {}) => {
    const fixedSchedules = (await FixedSchedule.findAll({ where: { studentId }, transaction })).map(plain);
    const last = await Cycle.findOne({
        where: { studentId, status: { [Op.in]: OPEN_STATUSES } },
        order: [['endDate', 'DESC']],
        transaction,
    });
    const today = localDate(now);
    const from = last && addDays(last.endDate, 1) > today ? addDays(last.endDate, 1) : today;
    return nextCycleStartDate(fixedSchedules, from, now) || from;
};

/** Academy creates a cycle waiting for payment. Amount and classes come from the settings. */
const createCycle = async ({ studentId, plan = CYCLE_PLAN.PAQUETE_4, startDate, actor, now = new Date(), transaction }) => {
    if (!Object.values(CYCLE_PLAN).includes(plan)) throw new DomainError('plan_invalido', 'El plan debe ser paquete de 4 o clase suelta.');
    const student = await User.findByPk(studentId, { transaction });
    if (!student || student.role !== ROLES.STUDENT) throw new DomainError('estudiante_invalido', 'El estudiante no existe.');

    const start = startDate || await suggestStartDate(studentId, { transaction, now });
    if (!DATE_PATTERN.test(start)) throw new DomainError('fecha_invalida', 'La fecha de inicio debe tener el formato AAAA-MM-DD.');
    const settings = await getSettings({ transaction });
    const endDate = computeEndDate(start, settings);

    const overlapping = await Cycle.findOne({
        where: {
            studentId,
            status: { [Op.in]: OPEN_STATUSES },
            startDate: { [Op.lte]: endDate },
            endDate: { [Op.gte]: start },
        },
        transaction,
    });
    if (overlapping) {
        throw new DomainError('ciclo_superpuesto', `Ya hay un ciclo del ${overlapping.startDate} al ${overlapping.endDate} para este estudiante.`, 409);
    }

    const cycle = await Cycle.create({
        studentId, plan, startDate: start, endDate, ...planDefaults(plan, settings),
    }, { transaction });
    await logAudit({
        entityType: 'cycle', entityId: cycle.id, action: 'crear', toStatus: PAYMENT_STATUS.PENDIENTE, actorId: actor?.id,
        details: { plan, startDate: start, amount: cycle.amount },
    }, { transaction });
    return cycle;
};

/**
 * Inside a booking transaction: confirms the payment, activates the cycle and
 * creates its lessons. If the first class of the planned start already passed
 * (late payment), the cycle moves to the next class day unless keepDates is set.
 */
const activateCycle = async (cycle, { actor, now = new Date(), keepDates = false, transaction }) => {
    if (cycle.status !== CYCLE_STATUS.PENDIENTE_PAGO) {
        throw new DomainError('ciclo_no_pendiente', 'Este ciclo ya no está esperando pago.', 409);
    }
    const settings = await getSettings({ transaction });
    const fixedSchedules = (await FixedSchedule.findAll({ where: { studentId: cycle.studentId }, transaction })).map(plain);
    const closures = (await ClosureDay.findAll({ transaction })).map(plain);
    const previousPayment = cycle.paymentStatus;
    const paidFields = {
        status: CYCLE_STATUS.ACTIVO,
        paymentStatus: PAYMENT_STATUS.PAGADO,
        confirmedById: actor.id,
        confirmedAt: new Date(now),
        rejectionReason: null,
    };

    // No class time yet (new student, or a new teacher): the cycle is paid and
    // waits for the teacher to schedule it; its dates are set at that moment.
    if (!nextCycleStartDate(fixedSchedules, cycle.startDate > localDate(now) ? cycle.startDate : localDate(now), now)) {
        await cycle.update(paidFields, { transaction });
        await logAudit({
            entityType: 'cycle', entityId: cycle.id, action: 'confirmar_pago',
            fromStatus: previousPayment, toStatus: PAYMENT_STATUS.PAGADO, actorId: actor.id,
            details: { porAgendar: true },
        }, { transaction });
        return { cycle: plain(cycle), lessons: [], unscheduled: true };
    }

    let { startDate, endDate } = cycle;
    if (!keepDates) {
        // First class day of the planned cycle, ignoring the current time
        const plannedFirstDay = nextCycleStartDate(fixedSchedules, startDate, toUtc(startDate));
        const firstClassStart = plannedFirstDay && firstSlotOn(fixedSchedules, plannedFirstDay);
        if (!firstClassStart || firstClassStart <= new Date(now)) {
            const today = localDate(now);
            const newStart = nextCycleStartDate(fixedSchedules, today > startDate ? today : startDate, now);
            if (!newStart) {
                throw new DomainError('sin_horario_fijo', 'El estudiante no tiene un horario fijo vigente. Pídele al profesor que se lo asigne.');
            }
            startDate = newStart;
            endDate = computeEndDate(startDate, settings);
        }
    }

    const { lessons } = assertOk(generateCycleLessons({
        cycle: { ...plain(cycle), startDate, endDate },
        fixedSchedules,
        closures,
    }));

    await cycle.update({ startDate, endDate, ...paidFields }, { transaction });
    const created = await Lesson.bulkCreate(lessons, { transaction });

    await logAudit({
        entityType: 'cycle', entityId: cycle.id, action: 'confirmar_pago',
        fromStatus: previousPayment, toStatus: PAYMENT_STATUS.PAGADO, actorId: actor.id,
        details: { startDate, endDate, lessons: created.length },
    }, { transaction });

    return { cycle: plain(cycle), lessons: created.map(plain), unscheduled: false };
};

/**
 * Inside a booking transaction, after the teacher gave the student a class time:
 * paid cycles that still have no lessons start at the next class and get them.
 * Returns the number of lessons created.
 */
const scheduleUnscheduledCycles = async (studentId, { actor, now = new Date(), transaction, from: firstDay }) => {
    const settings = await getSettings({ transaction });
    const fixedSchedules = (await FixedSchedule.findAll({ where: { studentId }, transaction })).map(plain);
    const closures = (await ClosureDay.findAll({ transaction })).map(plain);
    const cycles = await Cycle.findAll({ where: { studentId, status: CYCLE_STATUS.ACTIVO }, order: [['startDate', 'ASC']], transaction });

    let from = firstDay && firstDay > localDate(now) ? firstDay : localDate(now);
    let created = 0;
    for (const cycle of cycles) {
        const count = await Lesson.count({ where: { cycleId: cycle.id }, transaction });
        if (count > 0) {
            if (cycle.endDate >= from) from = addDays(cycle.endDate, 1);
            continue;
        }
        const startDate = nextCycleStartDate(fixedSchedules, from, now);
        if (!startDate) break;
        const endDate = computeEndDate(startDate, settings);
        const { lessons } = assertOk(generateCycleLessons({ cycle: { ...plain(cycle), startDate, endDate }, fixedSchedules, closures }));
        await cycle.update({ startDate, endDate }, { transaction });
        await Lesson.bulkCreate(lessons, { transaction });
        await logAudit({
            entityType: 'cycle', entityId: cycle.id, action: 'agendar', actorId: actor?.id,
            details: { startDate, endDate, lessons: lessons.length },
        }, { transaction });
        created += lessons.length;
        from = addDays(endDate, 1);
    }
    return created;
};

const confirmCyclePayment = async ({ cycleId, actor, now = new Date(), keepDates = false }) => {
    const draft = await Cycle.findByPk(cycleId);
    if (!draft) throw new DomainError('ciclo_no_encontrado', 'Ciclo no encontrado.', 404);

    return runBookingTransaction({ userIds: [draft.studentId] }, async (transaction) => {
        const cycle = await Cycle.findByPk(cycleId, { transaction });
        return activateCycle(cycle, { actor, now, keepDates, transaction });
    });
};

/** The receipt is not valid: back to pendiente with the reason the student will see. */
const rejectPayment = async ({ cycleId, actor, reason }) => {
    if (!reason || !reason.trim()) throw new DomainError('motivo_requerido', 'Indica por qué se rechaza el pago.');
    return sequelize.transaction(async (transaction) => {
        const cycle = await Cycle.findByPk(cycleId, { transaction });
        if (!cycle) throw new DomainError('ciclo_no_encontrado', 'Ciclo no encontrado.', 404);
        if (cycle.status !== CYCLE_STATUS.PENDIENTE_PAGO) {
            throw new DomainError('ciclo_no_pendiente', 'Este ciclo ya no está esperando pago.', 409);
        }
        const from = cycle.paymentStatus;
        await cycle.update({ paymentStatus: PAYMENT_STATUS.PENDIENTE, rejectionReason: reason.trim() }, { transaction });
        await logAudit({
            entityType: 'cycle', entityId: cycle.id, action: 'rechazar_pago',
            fromStatus: from, toStatus: PAYMENT_STATUS.PENDIENTE, actorId: actor.id, details: { reason: reason.trim() },
        }, { transaction });
        return plain(cycle);
    });
};

/** Checks the student (or academy) can upload a receipt for this cycle now. */
const assertCanSubmitReceipt = (cycle, actor, student) => {
    if (!cycle) throw new DomainError('ciclo_no_encontrado', 'Ciclo no encontrado.', 404);
    if (!canManageStudentBookings(actor, student)) {
        throw new DomainError('sin_permiso', 'No puedes subir comprobantes de este estudiante.', 403);
    }
    if (cycle.status !== CYCLE_STATUS.PENDIENTE_PAGO) {
        throw new DomainError('ciclo_no_pendiente', 'Esta mensualidad ya no está esperando pago.', 409);
    }
};

/**
 * Stores the receipt path and moves the payment to en_revision for the academy.
 * Returns { cycle, previousReceipt } so the caller can remove the replaced file.
 */
const submitReceipt = async ({ cycleId, actor, receiptPath, now = new Date() }) =>
    sequelize.transaction(async (transaction) => {
        const cycle = await Cycle.findByPk(cycleId, { transaction });
        const student = cycle && await User.findByPk(cycle.studentId, { transaction });
        assertCanSubmitReceipt(cycle, actor, student);

        const previousReceipt = cycle.receiptPath;
        const from = cycle.paymentStatus;
        await cycle.update({
            receiptPath,
            receiptUploadedAt: new Date(now),
            paymentStatus: PAYMENT_STATUS.EN_REVISION,
            rejectionReason: null,
        }, { transaction });
        await logAudit({
            entityType: 'cycle', entityId: cycle.id, action: 'subir_comprobante',
            fromStatus: from, toStatus: PAYMENT_STATUS.EN_REVISION, actorId: actor.id,
        }, { transaction });
        return { cycle: plain(cycle), student: student.toJSON(), previousReceipt };
    });

/** Cancels a cycle that was never paid (e.g. created by mistake). */
const cancelCycle = async ({ cycleId, actor }) =>
    sequelize.transaction(async (transaction) => {
        const cycle = await Cycle.findByPk(cycleId, { transaction });
        if (!cycle) throw new DomainError('ciclo_no_encontrado', 'Ciclo no encontrado.', 404);
        if (cycle.status !== CYCLE_STATUS.PENDIENTE_PAGO) {
            throw new DomainError('ciclo_no_pendiente', 'Solo se pueden anular ciclos que no se han pagado.', 409);
        }
        await cycle.update({ status: CYCLE_STATUS.CANCELADO }, { transaction });
        await logAudit({
            entityType: 'cycle', entityId: cycle.id, action: 'anular',
            fromStatus: CYCLE_STATUS.PENDIENTE_PAGO, toStatus: CYCLE_STATUS.CANCELADO, actorId: actor.id,
        }, { transaction });
        return plain(cycle);
    });

module.exports = {
    suggestStartDate, createCycle, activateCycle, scheduleUnscheduledCycles, confirmCyclePayment, rejectPayment, cancelCycle,
    assertCanSubmitReceipt, submitReceipt,
};
