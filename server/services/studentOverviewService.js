// Everything the student's dashboard needs in one call: next lesson (and
// until when it can be changed), the cycle in course, the next payment and
// the classes the teacher cancelled that are waiting for their make-up.
const { Op } = require('sequelize');
const { Cycle, Lesson, Room, User, Payment } = require('../models');
const { describePayment } = require('./paymentService');
const { CYCLE_STATUS, LESSON_STATUS } = require('../domain/constants');
const { summarizeCycle, pendingMakeups } = require('../domain/cycles');
const { checkStudentChange, pendingMakeupDeadline } = require('../domain/classRules');
const { localDate, monthOf, addMonths } = require('../domain/time');
const { getSettings } = require('./settingsService');
const { isBlockedByPayment, monthChargeOf, paymentTextFor } = require('./billingService');
const { statusFor } = require('./termsService');
const { paymentStanding } = require('../domain/billing');

const plain = (row) => row.get({ plain: true });

const buildStudentOverview = async (studentId, now = new Date()) => {
    const settings = await getSettings();
    const [cycles, lessons, rooms, student] = await Promise.all([
        Cycle.findAll({ where: { studentId, status: { [Op.in]: [CYCLE_STATUS.ACTIVO, CYCLE_STATUS.PENDIENTE_PAGO] } }, order: [['startDate', 'ASC']] }),
        Lesson.findAll({ where: { studentId }, order: [['startsAt', 'ASC']] }),
        Room.findAll({ attributes: ['id', 'name'] }),
        User.findByPk(studentId, { include: [{ model: User, as: 'Teacher', attributes: ['id', 'name'] }] }),
    ]);
    const roomName = Object.fromEntries(rooms.map(r => [r.id, r.name]));
    const allLessons = lessons.map(plain).map(l => ({ ...l, roomName: roomName[l.roomId] }));
    const lessonsOf = (cycleId) => allLessons.filter(l => l.cycleId === cycleId);

    const today = localDate(now);
    const active = cycles.filter(c => c.status === CYCLE_STATUS.ACTIVO);
    const current = active.find(c => c.startDate <= today && today <= c.endDate) || active[0] || null;
    const nextPayment = cycles.find(c => c.status === CYCLE_STATUS.PENDIENTE_PAGO) || null;

    const cycleView = (cycle) => {
        if (!cycle) return null;
        const summary = summarizeCycle(cycle, lessonsOf(cycle.id), now);
        return {
            ...plain(cycle),
            summary: {
                ...summary,
                nextLesson: undefined,
                units: summary.units.map(u => ({ state: u.state, lessonId: u.lesson.id, startsAt: u.lesson.startsAt, status: u.lesson.status })),
            },
        };
    };

    const found = allLessons.find(l => l.status === LESSON_STATUS.PROGRAMADA && new Date(l.startsAt) > new Date(now)) || null;
    // Who gives it when the teacher is replaced
    const substitute = found?.substituteTeacherId ? await User.findByPk(found.substituteTeacherId, { attributes: ['name'] }) : null;
    const nextLesson = found && { ...found, substituteLabel: substitute?.name || found.substituteName || null };
    // Whether the next class can still be changed, and until when ("Puedes cambiar esta clase hasta...")
    let nextLessonRule = null;
    if (nextLesson) {
        const month = monthOf(localDate(nextLesson.startsAt));
        const changesThisMonth = allLessons.filter(l =>
            l.status === LESSON_STATUS.REPROGRAMADA_POR_ESTUDIANTE && monthOf(localDate(l.startsAt)) === month).length;
        const paymentBlocked = await isBlockedByPayment(studentId, nextLesson.period || month, { now });
        const termsPending = !!student && (await statusFor(student, { now })).required === true;
        nextLessonRule = checkStudentChange({ lesson: nextLesson, now, settings, changesThisMonth, paymentBlocked, termsPending });
    }

    // Classes the teacher cancelled: the teacher books the make-up, by this deadline
    const owed = pendingMakeups(allLessons).map(l => ({
        ...l,
        makeupDeadline: pendingMakeupDeadline(l),
    }));

    // Monthly billing: the payment to show first (one waiting for the student,
    // else this month's, else next month's: paid in advance before it starts)
    const payments = (await Payment.findAll({ where: { studentId, status: { [Op.ne]: 'anulado' } }, order: [['createdAt', 'ASC']] })).map(plain);
    const toPay = payments.filter(p => ['por_pagar', 'rechazado'].includes(p.status));
    const thisMonth = monthOf(localDate(now));
    const featured = toPay[0]
        || payments.find(p => p.status === 'en_revision')
        || (await monthChargeOf(studentId, thisMonth))?.get({ plain: true })
        || (await monthChargeOf(studentId, addMonths(thisMonth, 1)))?.get({ plain: true })
        || null;
    const paymentView = (p) => p && {
        ...p,
        description: describePayment(p),
        standing: paymentStanding({ payment: p, now, settings }),
    };

    return {
        teacherName: student?.Teacher?.name || null,
        nextLesson: nextLesson && { ...nextLesson, rule: nextLessonRule },
        payment: paymentView(featured),
        paymentsToPay: toPay.length,
        // Bank account / Nequi and instructions for the payment screen
        paymentText: student ? (await paymentTextFor(student, { settings }).catch(() => ({ text: '' }))).text : '',
        currentCycle: cycleView(current),
        nextPayment: cycleView(nextPayment),
        pendingMakeups: owed,
        rules: {
            horas_minimas_aviso: settings.horas_minimas_aviso,
            tope_cambios_mes: settings.tope_cambios_mes,
        },
    };
};

module.exports = { buildStudentOverview };
