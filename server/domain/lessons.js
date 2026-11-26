// Rules for moving, making up, cancelling and grading a lesson.
const { LESSON_STATUS, CYCLE_STATUS, ROLES, AVAILABILITY_TYPE } = require('./constants');
const { ok, fail } = require('./errors');
const { cycleDeadline, reschedulesUsed, hasActiveMakeup, pendingMakeups, OWED_MAKEUP_STATUSES } = require('./cycles');
const { findDatedConflict, isOccupying, isFifthWeek } = require('./conflicts');
const { hasSubstitute } = require('./absences');
const { checkStudentMakeupTarget, pendingMakeupDeadline } = require('./classRules');
const {
    addHours, localParts, timeToMinutes, toUtc, addMinutes, eachDay, formatInstant, formatDay, minutesToTime,
} = require('./time');

// Last moment a lesson can still be rescheduled by the student
const rescheduleDeadline = (lesson, settings) => addHours(lesson.startsAt, -settings.horas_minimas_aviso);

const lessonMinutes = (lesson) => Math.round((new Date(lesson.endsAt) - new Date(lesson.startsAt)) / 60000);

/**
 * Can the student move this lesson? Needs at least horas_minimas_aviso hours
 * of notice and a reschedule left in the cycle. A lesson a substitute gives
 * cannot be moved: the substitute was booked for that time.
 * Returns { ok, deadline, remaining } or a failure.
 */
const checkStudentReschedule = ({ lesson, cycle, cycleLessons, settings, now }) => {
    if (lesson.status !== LESSON_STATUS.PROGRAMADA) {
        return fail('clase_no_programada', 'Solo se pueden reprogramar clases programadas.');
    }
    if (hasSubstitute(lesson)) {
        return fail(
            'clase_con_reemplazo',
            'Esta clase la da un profesor de reemplazo, así que no se puede reprogramar. Si necesitas cambiarla, habla con la academia.'
        );
    }
    if (cycle.status !== CYCLE_STATUS.ACTIVO) {
        return fail('ciclo_inactivo', 'El ciclo de esta clase no está activo.');
    }
    const deadline = rescheduleDeadline(lesson, settings);
    if (new Date(now) > deadline) {
        return fail(
            'aviso_insuficiente',
            `Ya no es posible reprogramar esta clase: se debe avisar con al menos ${settings.horas_minimas_aviso} horas de anticipación.`
        );
    }
    const used = reschedulesUsed(cycleLessons);
    const max = settings.max_reprogramaciones_por_ciclo;
    if (used >= max) {
        return fail(
            'limite_reprogramaciones',
            `Ya usaste ${used} de ${max} ${max === 1 ? 'reprogramación' : 'reprogramaciones'} de este ciclo.`
        );
    }
    return ok({ deadline, remaining: max - used });
};

// A lesson cancelled by the teacher or the academy that still has no make-up
const checkMakeupOwed = (lesson, lessons) => {
    if (!OWED_MAKEUP_STATUSES.includes(lesson.status)) {
        return fail('sin_reposicion_pendiente', 'Esta clase no tiene una reposición pendiente.');
    }
    if (hasActiveMakeup(lesson, lessons)) {
        return fail('reposicion_ya_agendada', 'Esta reposición ya fue agendada.', 409);
    }
    // Its make-up was cancelled too: that make-up is the one to reschedule
    if (!pendingMakeups(lessons).some(l => l.id === lesson.id)) {
        return fail('reposicion_ya_agendada', 'Esta clase ya tiene una reposición; agenda esa en su lugar.', 409);
    }
    return ok();
};

const isClosureDay = (date, closures) => closures.some(c => c.date === date);

/**
 * Basic checks for the new date of a moved lesson or a make-up.
 * mode 'cambio' (the student changes a class, monthly model): same month as
 *   `original`, at least horas_minimas_aviso ahead (see classRules.js).
 * mode 'reposicion' (make-up owed by the teacher): with `original`, no later
 *   than the end of the month after the cancelled class.
 * mode 'mover' (the teacher moves a class): checked apart by checkTeacherMove.
 * mode 'reprogramacion' (4-week cycles): must end before the cycle expires.
 */
const checkMakeupTarget = ({ startsAt, endsAt, mode, cycle, original = null, closures = [], settings, now }) => {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (start <= new Date(now)) {
        return fail('horario_pasado', 'El nuevo horario ya pasó.');
    }
    const { date, time, weekday } = localParts(start);
    if (weekday === 7) {
        return fail('fuera_de_horario', 'La academia no abre los domingos.');
    }
    if (time < settings.hora_apertura || localParts(end).time > settings.hora_cierre || localParts(end).date !== date) {
        return fail('fuera_de_horario', `El horario debe estar entre ${settings.hora_apertura} y ${settings.hora_cierre}.`);
    }
    if (isClosureDay(date, closures)) {
        return fail('dia_cierre', `La academia está cerrada el ${formatDay(date)}.`);
    }
    if (mode === 'reprogramacion' && end > cycleDeadline(cycle)) {
        return fail(
            'despues_del_vencimiento',
            `La nueva clase debe ser antes del vencimiento del ciclo (${formatDay(cycle.endDate)}).`
        );
    }
    if (mode === 'cambio') return checkStudentMakeupTarget({ original, startsAt: start, now, settings });
    if (mode === 'reposicion' && original) {
        const deadline = pendingMakeupDeadline(original);
        if (date > deadline) {
            return fail('despues_del_plazo', `La reposición de esta clase tiene que ser a más tardar el ${formatDay(deadline)}.`);
        }
    }
    return ok();
};

// Does [startsAt, endsAt) fit inside one occurrence of a weekly window?
const fitsWindow = (window, startsAt, endsAt) => {
    const start = localParts(startsAt);
    const end = localParts(endsAt);
    return start.weekday === window.weekday &&
        start.date === end.date &&
        start.time >= window.startTime &&
        end.time <= window.endTime;
};

// Make-ups already booked in this window on that day
const windowBookingsOn = (window, date, lessons) =>
    lessons.filter(l => l.availabilityId === window.id && isOccupying(l) && localParts(l.startsAt).date === date);

const checkWindowSlot = ({ window, startsAt, endsAt, lessons }) => {
    if (window.type !== AVAILABILITY_TYPE.REPOSICION || window.active === false) {
        return fail('franja_invalida', 'Ese horario no es una franja de reposición.');
    }
    if (!fitsWindow(window, startsAt, endsAt)) {
        return fail('fuera_de_franja', 'El horario elegido no está dentro de la franja de reposición.');
    }
    const date = localParts(startsAt).date;
    if (windowBookingsOn(window, date, lessons).length >= window.capacity) {
        return fail('cupo_lleno', `La franja del ${formatInstant(startsAt)} ya no tiene cupo.`, 409);
    }
    return ok();
};

/**
 * Bookable make-up slots for one lesson: the teacher's make-up windows,
 * stepped by the lesson length, with free capacity and no conflicts.
 * ctx is the conflict context ({ lessons, fixedSchedules, availabilities, holds, now, roomNames }).
 */
const listMakeupOptions = ({ lesson, windows, fromDate, toDate, mode, cycle, closures, settings, ctx, ignoreLessonIds = [] }) => {
    const duration = lessonMinutes(lesson);
    const options = [];
    for (const date of eachDay(fromDate, toDate)) {
        const weekday = localParts(toUtc(date, '12:00')).weekday;
        for (const window of windows) {
            if (window.weekday !== weekday || window.type !== AVAILABILITY_TYPE.REPOSICION || window.active === false) continue;
            if (windowBookingsOn(window, date, ctx.lessons).length >= window.capacity) continue;

            for (let m = timeToMinutes(window.startTime); m + duration <= timeToMinutes(window.endTime); m += duration) {
                const startsAt = toUtc(date, minutesToTime(m));
                const endsAt = addMinutes(startsAt, duration);
                if (!checkMakeupTarget({ startsAt, endsAt, mode, cycle, original: lesson, closures, settings, now: ctx.now }).ok) continue;
                const conflict = findDatedConflict({
                    startsAt, endsAt,
                    roomId: window.roomId,
                    teacherId: lesson.teacherId,
                    studentId: lesson.studentId,
                    ignoreLessonIds,
                }, ctx);
                if (!conflict) options.push({ availabilityId: window.id, roomId: window.roomId, startsAt, endsAt });
            }
        }
    }
    return options;
};

/**
 * The 5th week of a month has no fixed class: each of the teacher's weekly
 * class times that week is an extra make-up slot (capacity 1), for any of their students.
 * Returns options { fixedScheduleId, availabilityId: null, roomId, startsAt, endsAt }.
 */
const listFifthWeekOptions = ({ lesson, fromDate, toDate, mode, cycle, closures, settings, ctx, ignoreLessonIds = [] }) => {
    if (!ctx.fifthWeekFree) return [];
    const duration = lessonMinutes(lesson);
    const options = [];
    for (const fixed of (ctx.fixedSchedules || []).filter(f => f.teacherId === lesson.teacherId)) {
        for (const date of eachDay(fromDate, toDate)) {
            if (!isFifthWeek(date) || localParts(toUtc(date, '12:00')).weekday !== fixed.weekday) continue;
            if (fixed.validFrom > date || (fixed.validTo && fixed.validTo < date)) continue;
            const startsAt = toUtc(date, fixed.startTime);
            const endsAt = addMinutes(startsAt, duration);
            if (!checkMakeupTarget({ startsAt, endsAt, mode, cycle, original: lesson, closures, settings, now: ctx.now }).ok) continue;
            const conflict = findDatedConflict({
                startsAt, endsAt, roomId: fixed.roomId, teacherId: lesson.teacherId, studentId: lesson.studentId, ignoreLessonIds,
            }, ctx);
            if (!conflict) options.push({ fixedScheduleId: fixed.id, availabilityId: null, roomId: fixed.roomId, startsAt, endsAt });
        }
    }
    return options;
};

/** Is startsAt the 5th-week slot of this fixed schedule? */
const isFifthWeekSlotOf = (fixed, startsAt) => {
    const { date, time, weekday } = localParts(startsAt);
    return isFifthWeek(date) && weekday === fixed.weekday && time === fixed.startTime &&
        fixed.validFrom <= date && (!fixed.validTo || date <= fixed.validTo);
};

// Teacher cancels: lesson must still be ahead. The academy's cancellations use their own status.
const checkCancellation = (lesson, actor, now) => {
    if (lesson.status !== LESSON_STATUS.PROGRAMADA) {
        return fail('clase_no_programada', 'Solo se pueden cancelar clases programadas.');
    }
    if (new Date(lesson.startsAt) <= new Date(now)) {
        return fail('clase_pasada', 'No se puede cancelar una clase que ya empezó.');
    }
    const status = actor.role === ROLES.ACADEMY ? LESSON_STATUS.CANCELADA_POR_ACADEMIA : LESSON_STATUS.CANCELADA_POR_PROFESOR;
    return ok({ status });
};

const checkAttendance = (lesson, status, now) => {
    if (![LESSON_STATUS.TOMADA, LESSON_STATUS.PERDIDA].includes(status)) {
        return fail('estado_invalido', 'La asistencia solo puede ser "tomada" o "perdida".');
    }
    if (![LESSON_STATUS.PROGRAMADA, LESSON_STATUS.TOMADA, LESSON_STATUS.PERDIDA].includes(lesson.status)) {
        return fail('clase_no_programada', 'Esta clase fue cancelada o reprogramada.');
    }
    if (new Date(lesson.startsAt) > new Date(now)) {
        return fail('clase_futura', 'La asistencia se marca cuando la clase ya empezó.');
    }
    return ok();
};

module.exports = {
    rescheduleDeadline,
    lessonMinutes,
    checkStudentReschedule,
    checkMakeupOwed,
    checkMakeupTarget,
    fitsWindow,
    windowBookingsOn,
    checkWindowSlot,
    listMakeupOptions,
    listFifthWeekOptions,
    isFifthWeekSlotOf,
    checkCancellation,
    checkAttendance,
};
