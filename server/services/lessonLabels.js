// Which class of the month each lesson is, for the agenda: "Clase 2 de 4",
// "Clase suelta" or "Reposición de la clase 2". A make-up (also a class moved
// by the teacher) takes the number of the class it replaces.
const { Op } = require('sequelize');
const { Lesson } = require('../models');

const ATTRS = ['id', 'studentId', 'period', 'cycleId', 'paymentId', 'kind', 'originalLessonId', 'startsAt'];
const MAX_CHAIN = 10;

// Classes of one student's month (or legacy cycle) are numbered together
const groupKey = (l) => (l.period ? `${l.studentId}|${l.period}` : l.cycleId ? `${l.studentId}|ciclo:${l.cycleId}` : null);
const isMonthClass = (l) => l.kind === 'regular' && !l.paymentId && !!groupKey(l);

/** Returns a Map lessonId -> label (lessons without a known place get none). */
const classLabels = async (lessons) => {
    const labels = new Map();
    if (!lessons.length) return labels;
    const byId = new Map(lessons.map(l => [l.id, l]));

    // Walk make-ups back to the class they replace (a class moved twice is a chain)
    let missing = lessons.filter(l => l.originalLessonId && !byId.has(l.originalLessonId)).map(l => l.originalLessonId);
    for (let step = 0; missing.length && step < MAX_CHAIN; step += 1) {
        const rows = await Lesson.findAll({ where: { id: [...new Set(missing)] }, attributes: ATTRS, raw: true });
        rows.forEach(r => byId.set(r.id, r));
        missing = rows.filter(r => r.originalLessonId && !byId.has(r.originalLessonId)).map(r => r.originalLessonId);
    }
    const rootOf = (lesson) => {
        let current = lesson;
        for (let step = 0; current.originalLessonId && byId.has(current.originalLessonId) && step < MAX_CHAIN; step += 1) {
            current = byId.get(current.originalLessonId);
        }
        return current;
    };
    const roots = new Map(lessons.map(l => [l.id, rootOf(l)]));

    // Every regular class of those months, to know the position and the total
    const monthRoots = [...roots.values()].filter(isMonthClass);
    const groups = new Map();
    if (monthRoots.length) {
        const periods = [...new Set(monthRoots.map(r => r.period).filter(Boolean))];
        const cycles = [...new Set(monthRoots.filter(r => !r.period).map(r => r.cycleId))];
        const rows = await Lesson.findAll({
            where: {
                studentId: [...new Set(monthRoots.map(r => r.studentId))],
                kind: 'regular',
                paymentId: null,
                [Op.or]: [
                    ...(periods.length ? [{ period: periods }] : []),
                    ...(cycles.length ? [{ cycleId: cycles }] : []),
                ],
            },
            attributes: ATTRS,
            raw: true,
        });
        for (const row of rows) {
            const key = groupKey(row);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        }
        for (const list of groups.values()) list.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    }

    for (const lesson of lessons) {
        const root = roots.get(lesson.id);
        const makeup = lesson.kind === 'reposicion';
        if (root.kind === 'regular' && root.paymentId) {
            labels.set(lesson.id, makeup ? 'Reposición de clase suelta' : 'Clase suelta');
            continue;
        }
        if (!isMonthClass(root)) continue;
        const list = groups.get(groupKey(root)) || [];
        const number = list.findIndex(l => l.id === root.id) + 1;
        if (!number) continue;
        labels.set(lesson.id, makeup ? `Reposición de la clase ${number}` : `Clase ${number} de ${list.length}`);
    }
    return labels;
};

module.exports = { classLabels };
