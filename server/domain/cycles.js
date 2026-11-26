// Cycles ("mensualidades"): dates, lesson generation, expiry and the summary
// shown in "Mi mensualidad".
const { CYCLE_STATUS, CYCLE_PLAN, LESSON_STATUS, LESSON_KIND } = require('./constants');
const { ok, fail } = require('./errors');
const { addDays, weekdayOf, toUtc, addMinutes, localParts, eachDay } = require('./time');

const OWED_MAKEUP_STATUSES = [LESSON_STATUS.CANCELADA_POR_PROFESOR, LESSON_STATUS.CANCELADA_POR_ACADEMIA];
const MOVED_STATUSES = [...OWED_MAKEUP_STATUSES, LESSON_STATUS.REPROGRAMADA_POR_ESTUDIANTE];
const ACTIVE_MAKEUP_STATUSES = [LESSON_STATUS.PROGRAMADA, LESSON_STATUS.TOMADA, LESSON_STATUS.PERDIDA];

const computeEndDate = (startDate, settings) => addDays(startDate, settings.duracion_ciclo_semanas * 7 - 1);

// The cycle ends at the end of endDate (local time): this is the first instant after it
const cycleDeadline = (cycle) => toUtc(addDays(cycle.endDate, 1), '00:00');

const isCycleExpired = (cycle, now) => new Date(now) >= cycleDeadline(cycle);

const planDefaults = (plan, settings) => {
    if (plan === CYCLE_PLAN.SUELTA) return { classesIncluded: 1, amount: settings.precio_clase_suelta };
    return { classesIncluded: 4, amount: settings.precio_paquete_4 };
};

const fixedValidOn = (fixed, date) => fixed.validFrom <= date && (!fixed.validTo || date <= fixed.validTo);

// First day from fromDate on which one of the fixed schedules has a slot still in the future.
// Used when a payment is confirmed after the planned start (the cycle moves forward).
const nextCycleStartDate = (fixedSchedules, fromDate, now) => {
    for (let i = 0; i < 14; i++) {
        const date = addDays(fromDate, i);
        const hasSlot = fixedSchedules.some(f =>
            f.weekday === weekdayOf(date) && fixedValidOn(f, date) && toUtc(date, f.startTime) > new Date(now)
        );
        if (hasSlot) return date;
    }
    return null;
};

/**
 * Lessons for a cycle from the student's fixed schedules. Lessons on closure
 * days are created as cancelada_por_academia (a make-up is owed).
 * Returns { ok, lessons } with plain attributes, or a failure.
 */
const generateCycleLessons = ({ cycle, fixedSchedules, closures = [] }) => {
    const schedules = fixedSchedules.filter(f => f.studentId === cycle.studentId);
    if (schedules.length === 0) {
        return fail('sin_horario_fijo', 'El estudiante no tiene un horario fijo. Asígnale uno antes de activar el ciclo.');
    }
    const closureByDate = new Map(closures.map(c => [c.date, c]));

    const lessons = [];
    for (const date of eachDay(cycle.startDate, cycle.endDate)) {
        for (const fixed of schedules) {
            if (fixed.weekday !== weekdayOf(date) || !fixedValidOn(fixed, date)) continue;
            const startsAt = toUtc(date, fixed.startTime);
            const closure = closureByDate.get(date);
            lessons.push({
                cycleId: cycle.id,
                studentId: cycle.studentId,
                teacherId: fixed.teacherId,
                roomId: fixed.roomId,
                startsAt,
                endsAt: addMinutes(startsAt, fixed.durationMinutes),
                kind: LESSON_KIND.REGULAR,
                status: closure ? LESSON_STATUS.CANCELADA_POR_ACADEMIA : LESSON_STATUS.PROGRAMADA,
                reason: closure ? `Cierre de la academia: ${closure.reason}` : null,
            });
        }
    }
    lessons.sort((a, b) => a.startsAt - b.startsAt);

    const included = lessons.slice(0, cycle.classesIncluded);
    if (included.length < cycle.classesIncluded) {
        return fail(
            'clases_insuficientes',
            `El horario fijo solo da ${included.length} de ${cycle.classesIncluded} clases entre ${cycle.startDate} y ${cycle.endDate}.`
        );
    }
    return ok({ lessons: included });
};

const isMakeupOf = (candidate, lesson) => !!lesson.id && candidate.originalLessonId === lesson.id;

const findMakeup = (lesson, lessons) =>
    lessons.find(l => isMakeupOf(l, lesson) && ACTIVE_MAKEUP_STATUSES.includes(l.status)) ||
    // A make-up that was itself moved or cancelled still continues the chain
    lessons.find(l => isMakeupOf(l, lesson));

// Follows reschedules and make-ups to the lesson that currently stands for a regular one
const latestInChain = (lesson, lessons) => {
    let current = lesson;
    for (let guard = 0; guard < 20; guard++) {
        if (!MOVED_STATUSES.includes(current.status)) return current;
        const next = findMakeup(current, lessons);
        if (!next) return current;
        current = next;
    }
    return current;
};

const hasActiveMakeup = (lesson, lessons) =>
    lessons.some(l => isMakeupOf(l, lesson) && ACTIVE_MAKEUP_STATUSES.includes(l.status));

// Lessons cancelled by the teacher or the academy that still have no make-up.
// Only the last lesson of a chain counts: if a make-up was itself cancelled,
// that make-up is what is owed, not the original.
// A make-up whose time ran out (makeupClosedAt) is not pending any more.
const pendingMakeups = (lessons) =>
    lessons.filter(l => OWED_MAKEUP_STATUSES.includes(l.status) && !l.makeupClosedAt && !lessons.some(other => isMakeupOf(other, l)));

const reschedulesUsed = (cycleLessons) =>
    cycleLessons.filter(l => l.status === LESSON_STATUS.REPROGRAMADA_POR_ESTUDIANTE).length;

/**
 * Summary for "Mi mensualidad": one unit per included class, following moves.
 * unit.state: tomada | perdida | por_reponer | proxima | programada
 */
const summarizeCycle = (cycle, cycleLessons, now) => {
    const regulars = cycleLessons
        .filter(l => l.kind === LESSON_KIND.REGULAR)
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

    const units = regulars.map(regular => {
        const lesson = latestInChain(regular, cycleLessons);
        let state;
        // A class past its end time that nobody cancelled counts as given, even
        // before the scheduled task marks it
        const finished = lesson.status === LESSON_STATUS.PROGRAMADA && new Date(lesson.endsAt) <= new Date(now);
        if (lesson.status === LESSON_STATUS.TOMADA || finished) state = 'tomada';
        else if (lesson.status === LESSON_STATUS.PERDIDA) state = 'perdida';
        else if (MOVED_STATUSES.includes(lesson.status)) state = 'por_reponer';
        else state = 'programada';
        return { state, lesson };
    });

    // A cycle paid in advance has not started: none of its classes is the next one yet
    const started = cycle.startDate <= localParts(now).date;
    const upcoming = units
        .filter(u => u.state === 'programada' && new Date(u.lesson.startsAt) > new Date(now))
        .sort((a, b) => new Date(a.lesson.startsAt) - new Date(b.lesson.startsAt))[0];
    if (upcoming && started) upcoming.state = 'proxima';

    return {
        started,
        total: cycle.classesIncluded,
        unscheduled: cycle.status === CYCLE_STATUS.ACTIVO && units.length === 0,
        taken: units.filter(u => u.state === 'tomada' || u.state === 'perdida').length,
        units,
        nextLesson: upcoming ? upcoming.lesson : null,
        pendingMakeups: pendingMakeups(cycleLessons).length,
        reschedulesUsed: reschedulesUsed(cycleLessons),
        deadline: cycleDeadline(cycle),
    };
};

/**
 * What happens when a cycle expires: lessons of the cycle still marked
 * programada already ended, so they count as given (tomada), like any class
 * that reached its end time. Make-ups owed by the teacher or the academy are
 * not lost: they stay pending, and make-ups booked after the end date keep their date.
 */
const planCycleExpiry = (cycle, cycleLessons, now) => {
    // A paid cycle the teacher has not scheduled yet waits: its dates are set when scheduled
    if (cycle.status !== CYCLE_STATUS.ACTIVO || !isCycleExpired(cycle, now) || cycleLessons.length === 0) {
        return { expire: false, lessonUpdates: [] };
    }
    const deadline = cycleDeadline(cycle);
    const lessonUpdates = cycleLessons
        .filter(l => l.status === LESSON_STATUS.PROGRAMADA && new Date(l.startsAt) < deadline)
        .map(l => ({ id: l.id, from: l.status, to: LESSON_STATUS.TOMADA }));
    return { expire: true, lessonUpdates };
};

const lessonLocalDate = (lesson) => localParts(lesson.startsAt).date;

module.exports = {
    OWED_MAKEUP_STATUSES,
    computeEndDate,
    cycleDeadline,
    isCycleExpired,
    planDefaults,
    nextCycleStartDate,
    generateCycleLessons,
    latestInChain,
    hasActiveMakeup,
    pendingMakeups,
    reschedulesUsed,
    summarizeCycle,
    planCycleExpiry,
    lessonLocalDate,
};
