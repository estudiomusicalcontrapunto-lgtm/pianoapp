// Academy home panel: receipts to review, charges still to pay, holds about to
// expire, the month's charges (paid vs pending) and room occupancy.
const { Op } = require('sequelize');
const { Assessment, Lesson, Room, Availability, User, Payment } = require('../models');
const { HOLD_STATUS } = require('../domain/constants');
const { PAYMENT_TYPE } = require('../domain/billing');
const { isOccupying } = require('../domain/conflicts');
const { isHoldActive } = require('../domain/holds');
const { pendingMakeups } = require('../domain/cycles');
const { localDate, addDays, toUtc, weekdayOf, timeToMinutes, formatMonth } = require('../domain/time');
const { getSettings } = require('./settingsService');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

const studentInclude = [{ model: User, as: 'student', attributes: ['id', 'name'] }];

// "Mensualidad de diciembre de 2026", "Clases sueltas de enero de 2027"...
const conceptOf = (payment) => {
    const month = payment.period ? ` de ${formatMonth(payment.period)}` : '';
    if (payment.type === PAYMENT_TYPE.MENSUALIDAD) return `Mensualidad${month}`;
    if (payment.type === PAYMENT_TYPE.PROPORCIONAL) return `Mes proporcional${month}`;
    if (payment.calculation?.debt) return `Clase tomada sin pagar${month}`;
    return `Clases sueltas${month}`;
};

const paymentItem = (payment, today) => ({
    id: payment.id,
    studentId: payment.studentId,
    studentName: payment.student?.name,
    type: payment.type,
    period: payment.period,
    concept: conceptOf(payment),
    amount: payment.amount,
    status: payment.status,
    dueDate: payment.dueDate,
    overdue: !!payment.dueDate && payment.dueDate < today,
});

const buildAcademyOverview = async ({ now = new Date(), month } = {}) => {
    const settings = await getSettings();
    const today = localDate(now);
    const selectedMonth = MONTH_PATTERN.test(month || '') ? month : today.slice(0, 7);
    const weekStart = addDays(today, 1 - weekdayOf(today));

    // The month's charges (mensualidad, proporcional, clases sueltas), cancelled ones aside
    const monthPayments = await Payment.findAll({ where: { period: selectedMonth, status: { [Op.ne]: 'anulado' } } });
    const paid = monthPayments.filter(p => p.status === 'aprobado');
    const pending = monthPayments.filter(p => p.status !== 'aprobado');
    const sum = (list) => list.reduce((total, p) => total + p.amount, 0);

    // Receipts to review, and charges nobody has paid yet (closest deadline first)
    const open = await Payment.findAll({
        where: { status: ['en_revision', 'por_pagar', 'rechazado'] },
        include: studentInclude,
        order: [['dueDate', 'ASC'], ['createdAt', 'ASC']],
    });

    // Holds that expire today or tomorrow
    const holds = await Assessment.findAll({
        where: { holdStatus: HOLD_STATUS.APARTADO, holdExpiresAt: { [Op.lt]: toUtc(addDays(today, 2)) } },
        include: [{ model: User, as: 'teacher', attributes: ['name'] }, { model: Room, as: 'holdRoom', attributes: ['name'] }],
        order: [['holdExpiresAt', 'ASC']],
    });

    // Room occupancy this week (lunes a sábado, academy hours)
    const rooms = await Room.findAll({ where: { active: true }, order: [['name', 'ASC']] });
    const weekLessons = await Lesson.findAll({
        where: { startsAt: { [Op.gte]: toUtc(weekStart), [Op.lt]: toUtc(addDays(weekStart, 6)) } },
    });
    const windows = await Availability.findAll({ where: { active: true } });
    const openMinutes = 6 * (timeToMinutes(settings.hora_cierre) - timeToMinutes(settings.hora_apertura));
    const minutesOf = (from, to) => Math.round((new Date(to) - new Date(from)) / 60000);

    const owed = pendingMakeups((await Lesson.findAll({
        where: { [Op.or]: [{ status: ['cancelada_por_profesor', 'cancelada_por_academia'] }, { originalLessonId: { [Op.ne]: null } }] },
    })).map(l => l.get({ plain: true })));

    return {
        today,
        month: selectedMonth,
        paymentDeadlineDay: settings.dia_limite_pago,
        income: {
            paid: sum(paid),
            pending: sum(pending),
            paidCount: paid.length,
            pendingCount: pending.length,
        },
        payments: {
            inReview: open.filter(p => p.status === 'en_revision').map(p => paymentItem(p, today)),
            toPay: open.filter(p => p.status !== 'en_revision').map(p => paymentItem(p, today)),
        },
        holdsExpiring: holds.map(h => ({
            id: h.id,
            studentName: h.studentName,
            contactPhone: h.contactPhone,
            teacherName: h.teacher?.name,
            roomName: h.holdRoom?.name,
            weekday: h.holdWeekday,
            startTime: h.holdStartTime,
            expiresAt: h.holdExpiresAt,
            active: isHoldActive(h, now),
        })),
        occupancy: rooms.map(room => {
            const booked = weekLessons.filter(l => l.roomId === room.id && isOccupying(l)).reduce((t, l) => t + minutesOf(l.startsAt, l.endsAt), 0);
            const assigned = windows.filter(w => w.roomId === room.id)
                .reduce((t, w) => t + timeToMinutes(w.endTime) - timeToMinutes(w.startTime), 0);
            return {
                roomId: room.id,
                roomName: room.name,
                bookedMinutes: booked,
                windowMinutes: assigned,
                openMinutes,
                bookedPercent: openMinutes ? Math.round((booked / openMinutes) * 100) : 0,
                windowPercent: openMinutes ? Math.round((assigned / openMinutes) * 100) : 0,
            };
        }),
        pendingMakeups: owed.length,
    };
};

module.exports = { buildAcademyOverview };
