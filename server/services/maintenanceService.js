// Scheduled tasks. Every task is idempotent: running them twice, or late,
// gives the same result, so they can run on a timer, at startup and on login.
const { Op } = require('sequelize');
const { sequelize, Assessment, Cycle, Lesson, ClosureDay, User, AuditLog, City, PaymentAdjustment } = require('../models');
const { HOLD_STATUS, CYCLE_STATUS, PAYMENT_STATUS, LESSON_STATUS, ROLES } = require('../domain/constants');
const { isHoldExpired } = require('../domain/holds');
const { planCycleExpiry, pendingMakeups, OWED_MAKEUP_STATUSES } = require('../domain/cycles');
const { planPendingMakeupExpiry } = require('../domain/classRules');
const { resolvePrices } = require('../domain/pricing');
const { formatCOP } = require('../domain/money');
const { localDate, localParts, addDays, toUtc, formatDay, formatInstant } = require('../domain/time');
const { runBookingTransaction } = require('./bookingTransaction');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./audit');
const { createNotice, notifyCancellations } = require('./noticeService');
const { runMonthlyBilling, enforcePaymentDeadlines } = require('./billingService');

const plain = (row) => row.get({ plain: true });

const academyIds = async () =>
    (await User.findAll({ where: { role: ROLES.ACADEMY, active: true }, attributes: ['id'] })).map(u => u.id);

/** Held slots past their expiry become liberado. */
const releaseExpiredHolds = async (now) => {
    const holds = await Assessment.findAll({ where: { holdStatus: HOLD_STATUS.APARTADO, holdExpiresAt: { [Op.lte]: now } } });
    const released = holds.filter(h => isHoldExpired(h, now));
    for (const hold of released) {
        await hold.update({ holdStatus: HOLD_STATUS.LIBERADO });
        await logAudit({
            entityType: 'assessment', entityId: hold.id, action: 'liberar_cupo_vencido',
            fromStatus: HOLD_STATUS.APARTADO, toStatus: HOLD_STATUS.LIBERADO,
        });
    }
    if (released.length) {
        await createNotice({
            category: 'cupo_liberado',
            title: 'Cupos apartados liberados',
            message: `Se liberaron los horarios apartados de ${released.map(h => h.studentName).join(', ')} porque no se registró el pago a tiempo.`,
            recipientIds: await academyIds(),
        });
    }
    return released.length;
};

/**
 * A class that reached its end time and was not cancelled or moved counts as
 * given: programada becomes tomada. The teacher marks only the exceptions
 * ("No asistió" = perdida), and can still change it afterwards.
 */
const markFinishedLessons = async (now) => {
    const finished = await Lesson.findAll({
        where: { status: LESSON_STATUS.PROGRAMADA, endsAt: { [Op.lte]: now } },
        attributes: ['id'],
    });
    if (!finished.length) return 0;
    await sequelize.transaction(async (transaction) => {
        await Lesson.update(
            { status: LESSON_STATUS.TOMADA, changedAt: new Date(now) },
            { where: { id: finished.map(l => l.id), status: LESSON_STATUS.PROGRAMADA }, transaction }
        );
        for (const lesson of finished) {
            await logAudit({
                entityType: 'lesson', entityId: lesson.id, action: 'tomada_automatica',
                fromStatus: LESSON_STATUS.PROGRAMADA, toStatus: LESSON_STATUS.TOMADA,
            }, { transaction });
        }
    });
    return finished.length;
};

/**
 * Cycles past their end date: lessons never marked become perdida and the cycle
 * is finalizado. Make-ups owed by the teacher or the academy stay pending.
 */
const expireCycles = async (now) => {
    const cycles = await Cycle.findAll({ where: { status: CYCLE_STATUS.ACTIVO, endDate: { [Op.lt]: localDate(now) } } });
    let lessonsLost = 0;
    for (const cycle of cycles) {
        await sequelize.transaction(async (transaction) => {
            const lessons = (await Lesson.findAll({ where: { cycleId: cycle.id }, transaction })).map(plain);
            const plan = planCycleExpiry(plain(cycle), lessons, now);
            if (!plan.expire) return;
            for (const update of plan.lessonUpdates) {
                await Lesson.update(
                    { status: update.to, changedAt: new Date(now) },
                    { where: { id: update.id }, transaction }
                );
                await logAudit({ entityType: 'lesson', entityId: update.id, action: 'vencer', fromStatus: update.from, toStatus: update.to }, { transaction });
            }
            await cycle.update({ status: CYCLE_STATUS.FINALIZADO }, { transaction });
            await logAudit({
                entityType: 'cycle', entityId: cycle.id, action: 'vencer',
                fromStatus: CYCLE_STATUS.ACTIVO, toStatus: CYCLE_STATUS.FINALIZADO, details: { lessonsLost: plan.lessonUpdates.length },
            }, { transaction });
            lessonsLost += plan.lessonUpdates.length;
        });
    }
    return { cycles: cycles.length, lessonsLost };
};

/** Cycles never paid whose dates already passed: the payment is vencido and the cycle is closed. */
const markOverduePayments = async (now) => {
    const cycles = await Cycle.findAll({
        where: {
            status: CYCLE_STATUS.PENDIENTE_PAGO,
            paymentStatus: PAYMENT_STATUS.PENDIENTE,
            endDate: { [Op.lt]: localDate(now) },
        },
    });
    for (const cycle of cycles) {
        await cycle.update({ paymentStatus: PAYMENT_STATUS.VENCIDO, status: CYCLE_STATUS.CANCELADO });
        await logAudit({
            entityType: 'cycle', entityId: cycle.id, action: 'vencer_pago',
            fromStatus: PAYMENT_STATUS.PENDIENTE, toStatus: PAYMENT_STATUS.VENCIDO,
        });
    }
    return cycles.length;
};

/**
 * NOT RUN ANY MORE: the academy has no closure days (2026-11-24). Kept only
 * until the monthly billing replaces cycles, then removed with ClosureDay.
 * Closure days: scheduled lessons on that day become cancelada_por_academia
 * (a make-up is owed) and the students are told. A closure is marked as
 * applied only once it cancelled something, so it can still be removed before.
 */
const applyClosures = async (now) => {
    const closures = await ClosureDay.findAll({ where: { appliedAt: null, date: { [Op.gte]: localDate(now) } } });
    let cancelled = 0;
    for (const closure of closures) {
        const from = toUtc(closure.date);
        const to = toUtc(addDays(closure.date, 1));
        const lessons = await Lesson.findAll({
            where: { status: LESSON_STATUS.PROGRAMADA, startsAt: { [Op.gte]: from, [Op.lt]: to } },
            attributes: ['roomId', 'teacherId', 'studentId'],
        });
        if (!lessons.length) continue;

        const changed = await runBookingTransaction({
            roomIds: lessons.map(l => l.roomId), userIds: [...lessons.map(l => l.teacherId), ...lessons.map(l => l.studentId)],
        }, async (transaction) => {
            const rows = await Lesson.findAll({
                where: { status: LESSON_STATUS.PROGRAMADA, startsAt: { [Op.gte]: from, [Op.lt]: to } },
                transaction,
            });
            for (const lesson of rows) {
                await lesson.update({
                    status: LESSON_STATUS.CANCELADA_POR_ACADEMIA,
                    reason: `Cierre de la academia: ${closure.reason}`,
                    changedAt: new Date(now),
                }, { transaction });
                await logAudit({
                    entityType: 'lesson', entityId: lesson.id, action: 'cierre',
                    fromStatus: LESSON_STATUS.PROGRAMADA, toStatus: LESSON_STATUS.CANCELADA_POR_ACADEMIA,
                    details: { closureId: closure.id },
                }, { transaction });
            }
            await closure.update({ appliedAt: new Date(now) }, { transaction });
            return rows.map(plain);
        });
        await notifyCancellations(changed, { id: null });
        cancelled += changed.length;
    }
    return cancelled;
};

/**
 * Payment reminders, dias_recordatorio_pago days before a cycle ends:
 * - the student, if the next cycle is waiting for payment;
 * - the academy, if no next cycle was created.
 * Each cycle gets one reminder (recorded in the audit log).
 */
const sendPaymentReminders = async (now) => {
    const settings = await getSettings();
    const today = localDate(now);
    const limit = addDays(today, settings.dias_recordatorio_pago);
    const ending = await Cycle.findAll({
        where: { status: CYCLE_STATUS.ACTIVO, endDate: { [Op.gte]: today, [Op.lte]: limit } },
        include: [{ model: User, as: 'student', attributes: ['id', 'name'] }],
    });
    let sent = 0;
    for (const cycle of ending) {
        const already = await AuditLog.findOne({ where: { entityType: 'cycle', entityId: cycle.id, action: 'recordatorio_pago' } });
        if (already) continue;

        const next = await Cycle.findOne({
            where: { studentId: cycle.studentId, startDate: { [Op.gt]: cycle.endDate }, status: { [Op.ne]: CYCLE_STATUS.CANCELADO } },
            order: [['startDate', 'ASC']],
        });
        if (next && next.status === CYCLE_STATUS.ACTIVO) continue;
        if (next && next.paymentStatus === PAYMENT_STATUS.EN_REVISION) continue;

        if (next) {
            await createNotice({
                category: 'recordatorio_pago',
                title: 'Recordatorio de pago',
                message: `Tu ciclo vence el ${formatDay(cycle.endDate)}. La próxima mensualidad (${formatCOP(next.amount)}) empieza el ${formatDay(next.startDate)}: confirma tu pago para asegurar tu horario.`,
                recipientIds: [cycle.studentId],
                meta: { cycleId: next.id },
            });
        } else {
            await createNotice({
                category: 'mensualidad_sin_crear',
                title: 'Mensualidad por crear',
                message: `El ciclo de ${cycle.student?.name} vence el ${formatDay(cycle.endDate)} y aún no tiene la siguiente mensualidad.`,
                recipientIds: await academyIds(),
                meta: { cycleId: cycle.id },
            });
        }
        await logAudit({ entityType: 'cycle', entityId: cycle.id, action: 'recordatorio_pago', details: { nextCycleId: next?.id || null } });
        sent++;
    }
    return sent;
};

/**
 * Pending make-ups whose time ran out (see domain/classRules.js):
 * - the student's (end of the class's month): lost;
 * - the teacher's (end of the next month): a single class of the student's city
 *   is discounted from their next payment, as an adjustment.
 * The lesson keeps its status; makeupClosedAt marks it as no longer pending.
 */
const expirePendingMakeups = async (now) => {
    const candidates = await Lesson.findAll({
        where: { status: OWED_MAKEUP_STATUSES, makeupClosedAt: null },
        attributes: ['id'],
    });
    if (!candidates.length) return { lost: 0, discounted: 0 };
    const candidateIds = candidates.map(c => c.id);
    const related = (await Lesson.findAll({
        where: { [Op.or]: [{ id: candidateIds }, { originalLessonId: candidateIds }] },
    })).map(plain);
    const pending = pendingMakeups(related);

    const students = await User.findAll({
        where: { id: [...new Set(pending.map(l => l.studentId))] },
        include: [{ model: City, as: 'city' }],
    });
    const studentById = Object.fromEntries(students.map(s => [s.id, s]));
    const pricesOf = (lesson) => {
        const city = studentById[lesson.studentId]?.city;
        return city ? resolvePrices({ city }) : { singleClassFee: 0 };
    };
    const { lost, discounts } = planPendingMakeupExpiry({ pending, now, pricesOf });
    const academy = await academyIds();

    for (const lesson of lost) {
        await Lesson.update({ makeupClosedAt: new Date(now), makeupOutcome: 'perdida' }, { where: { id: lesson.id } });
        await logAudit({ entityType: 'lesson', entityId: lesson.id, action: 'reposicion_vencida', details: { outcome: 'perdida' } });
    }

    for (const discount of discounts) {
        const lesson = pending.find(l => l.id === discount.lessonId);
        await sequelize.transaction(async (transaction) => {
            const already = await PaymentAdjustment.findOne({ where: { lessonId: lesson.id, kind: discount.kind }, transaction });
            if (!already) {
                await PaymentAdjustment.create({
                    studentId: lesson.studentId, lessonId: lesson.id, kind: discount.kind, amount: discount.amount, reason: discount.reason,
                }, { transaction });
            }
            await Lesson.update({ makeupClosedAt: new Date(now), makeupOutcome: 'descontada' }, { where: { id: lesson.id }, transaction });
            await logAudit({
                entityType: 'lesson', entityId: lesson.id, action: 'reposicion_vencida',
                details: { outcome: 'descontada', amount: discount.amount },
            }, { transaction });
        });
        const student = studentById[lesson.studentId];
        await createNotice({
            category: 'descuento_clase',
            title: 'Descuento en tu próximo pago',
            message: `La reposición de tu clase del ${formatInstant(lesson.startsAt)} no se alcanzó a dar. Te descontamos ${formatCOP(Math.abs(discount.amount))} de tu próximo pago.`,
            recipientIds: [lesson.studentId],
            meta: { lessonId: lesson.id },
        });
        await createNotice({
            category: 'reposicion_no_dada',
            title: 'Reposición no dada',
            message: `No se repuso a tiempo la clase de ${student?.name || 'un estudiante'} del ${formatInstant(lesson.startsAt)} que canceló el profesor. Se descuenta ${formatCOP(Math.abs(discount.amount))} de su próximo pago.`,
            recipientIds: [lesson.teacherId, ...academy],
            meta: { lessonId: lesson.id },
        });
    }
    return { lost: lost.length, discounted: discounts.length };
};

let running = null;
let lastRunAt = 0;

/** Runs every task in order. Concurrent calls share the run in progress. */
const runMaintenance = (now = new Date()) => {
    if (running) return running;
    running = (async () => {
        try {
            const result = {
                ranAt: new Date(now).toISOString(),
                hour: localParts(now).time,
                holdsReleased: await releaseExpiredHolds(now),
                lessonsTaken: await markFinishedLessons(now),
                expired: await expireCycles(now),
                makeupsExpired: await expirePendingMakeups(now),
                // Monthly billing: the month's charge and classes, then the deadline
                monthsCharged: await runMonthlyBilling(now),
                unpaidReleased: await enforcePaymentDeadlines(now),
                overduePayments: await markOverduePayments(now),
                reminders: await sendPaymentReminders(now),
            };
            lastRunAt = Date.now();
            return result;
        } finally {
            running = null;
        }
    })();
    return running;
};

// For triggers like login: runs at most every few minutes and never blocks the caller
const runMaintenanceThrottled = (minIntervalMs = 5 * 60 * 1000) => {
    if (Date.now() - lastRunAt < minIntervalMs) return;
    runMaintenance().catch(error => console.error('Maintenance error:', error));
};

module.exports = {
    releaseExpiredHolds,
    expireCycles,
    expirePendingMakeups,
    markOverduePayments,
    applyClosures,
    markFinishedLessons,
    sendPaymentReminders,
    runMaintenance,
    runMaintenanceThrottled,
};
