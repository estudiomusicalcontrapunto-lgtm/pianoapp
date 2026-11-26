// Practice days and the streak. The student marks only today (America/Bogota);
// teachers and the academy read the days, week by week.
const { Op } = require('sequelize');
const { sequelize, PracticeDay, User } = require('../models');
const { DomainError } = require('../domain/errors');
const { computeStreak, currentStreak, weekStartOf, weekDays } = require('../domain/practice');
const { localDate, addDays } = require('../domain/time');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// A streak longer than this is not counted further back (more than a year of daily practice)
const STREAK_LOOKBACK_DAYS = 400;

/** Marks today as practiced (once a day) and updates the stored streak. Returns the student. */
const markPracticeToday = async ({ studentId, now = new Date() }) => sequelize.transaction(async (transaction) => {
    const student = await User.findByPk(studentId, { transaction });
    if (!student || student.role !== 'student') throw new DomainError('estudiante_invalido', 'Solo los estudiantes marcan práctica.', 403);
    const today = localDate(now);
    await PracticeDay.findOrCreate({ where: { studentId, date: today }, transaction });

    const recent = await PracticeDay.findAll({
        where: { studentId, date: { [Op.gte]: addDays(today, -STREAK_LOOKBACK_DAYS) } },
        attributes: ['date'],
        transaction,
    });
    await student.update({ lastPractice: today, streak: computeStreak(recent.map(d => d.date), today) }, { transaction });
    return student;
});

/**
 * One week (Monday to Sunday) of a student's practice:
 * { weekStart, today, streak, days: [{ date, practiced }] }. weekStart defaults to this week.
 */
const getPracticeWeek = async ({ student, weekStart, now = new Date() }) => {
    const today = localDate(now);
    if (weekStart && !DATE_PATTERN.test(weekStart)) throw new DomainError('fecha_invalida', 'La semana no es válida.');
    const start = weekStartOf(weekStart || today);
    const days = weekDays(start);
    const practiced = await PracticeDay.findAll({
        where: { studentId: student.id, date: { [Op.between]: [days[0], days[6]] } },
        attributes: ['date'],
    });
    const marked = new Set(practiced.map(p => p.date));
    return {
        weekStart: start,
        today,
        streak: currentStreak(student, today),
        days: days.map(date => ({ date, practiced: marked.has(date) })),
    };
};

/** This week's practiced days of several students: { [studentId]: ['YYYY-MM-DD', ...] } */
const practicedThisWeek = async (studentIds, { now = new Date() } = {}) => {
    const days = weekDays(weekStartOf(localDate(now)));
    const rows = studentIds.length
        ? await PracticeDay.findAll({ where: { studentId: studentIds, date: { [Op.between]: [days[0], days[6]] } }, attributes: ['studentId', 'date'] })
        : [];
    const byStudent = Object.fromEntries(studentIds.map(id => [id, []]));
    for (const row of rows) byStudent[row.studentId].push(row.date);
    return byStudent;
};

module.exports = { markPracticeToday, getPracticeWeek, practicedThisWeek };
