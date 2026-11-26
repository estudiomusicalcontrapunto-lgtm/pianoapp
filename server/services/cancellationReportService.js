// Register of the classes each teacher cancelled, for the academy. A class the
// teacher only moved to another time is not a cancellation and is left out.
const { Op } = require('sequelize');
const { Lesson, User } = require('../models');
const { LESSON_STATUS } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { pendingMakeupDeadline } = require('../domain/classRules');
const { toUtc, addDays, firstDayOfMonth, lastDayOfMonth, localDate } = require('../domain/time');

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACTIVE = [LESSON_STATUS.PROGRAMADA, LESSON_STATUS.TOMADA, LESSON_STATUS.PERDIDA];

/**
 * What became of the make-up of a cancelled class:
 * repuesta (given; the student came or not) | agendada (booked, still ahead) |
 * pendiente (not booked yet, within its deadline) | descontada (not given in time).
 */
const makeupStatus = (lesson, makeup, now) => {
    if (lesson.makeupOutcome === 'descontada') return 'descontada';
    if (makeup && [LESSON_STATUS.TOMADA, LESSON_STATUS.PERDIDA].includes(makeup.status)) return 'repuesta';
    if (makeup && makeup.status === LESSON_STATUS.PROGRAMADA) return new Date(makeup.endsAt) <= new Date(now) ? 'repuesta' : 'agendada';
    return 'pendiente';
};

/**
 * Cancellations by teacher in a month ('YYYY-MM'), optionally for one teacher.
 * Returns { month, teachers: [{ teacherId, teacherName, total, pending, discounted, lessons: [...] }] }.
 */
const buildCancellationReport = async ({ month, teacherId = null, now = new Date() }) => {
    if (!MONTH_PATTERN.test(month || '')) throw new DomainError('mes_invalido', 'El mes debe tener el formato AAAA-MM.');
    const where = {
        status: LESSON_STATUS.CANCELADA_POR_PROFESOR,
        moved: { [Op.not]: true },
        startsAt: { [Op.gte]: toUtc(firstDayOfMonth(month)), [Op.lt]: toUtc(addDays(lastDayOfMonth(month), 1)) },
    };
    if (teacherId) where.teacherId = teacherId;

    const cancelled = await Lesson.findAll({
        where,
        include: [
            { model: User, as: 'student', attributes: ['id', 'name'] },
            { model: User, as: 'teacher', attributes: ['id', 'name'] },
        ],
        order: [['startsAt', 'ASC']],
    });
    const makeups = cancelled.length
        ? await Lesson.findAll({ where: { originalLessonId: cancelled.map(l => l.id) }, order: [['createdAt', 'ASC']] })
        : [];

    const byTeacher = new Map();
    for (const row of cancelled) {
        const lesson = row.get({ plain: true });
        const own = makeups.filter(m => m.originalLessonId === lesson.id);
        const makeup = own.find(m => ACTIVE.includes(m.status)) || null;
        const status = makeupStatus(lesson, makeup, now);
        const entry = byTeacher.get(lesson.teacherId) || {
            teacherId: lesson.teacherId, teacherName: lesson.teacher?.name || '', total: 0, pending: 0, discounted: 0, lessons: [],
        };
        entry.total += 1;
        if (status === 'pendiente') entry.pending += 1;
        if (status === 'descontada') entry.discounted += 1;
        entry.lessons.push({
            id: lesson.id,
            studentName: lesson.student?.name || '',
            startsAt: lesson.startsAt,
            cancelledAt: lesson.changedAt,
            reason: lesson.reason,
            makeupStatus: status,
            makeupStartsAt: makeup?.startsAt || null,
            deadline: pendingMakeupDeadline(lesson),
            overdue: status === 'pendiente' && localDate(now) > pendingMakeupDeadline(lesson),
        });
        byTeacher.set(lesson.teacherId, entry);
    }
    const teachers = [...byTeacher.values()].sort((a, b) => b.total - a.total || a.teacherName.localeCompare(b.teacherName));
    return { month, teachers };
};

module.exports = { buildCancellationReport, makeupStatus };
