// Checks for weekly slots (fixed schedules and held slots) before the conflict check.
const { AVAILABILITY_TYPE } = require('./constants');
const { ok, fail } = require('./errors');
const { timeToMinutes, minutesToTime, WEEKDAY_NAMES } = require('./time');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const endTimeOf = (startTime, durationMinutes) => minutesToTime(timeToMinutes(startTime) + durationMinutes);

// Day 1-6 (lunes a sábado), HH:mm, within the academy's opening hours
const checkWeeklySlot = ({ weekday, startTime, endTime, settings }) => {
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) {
        return fail('dia_invalido', 'El día debe ser de lunes a sábado.');
    }
    if (!TIME_PATTERN.test(startTime || '') || !TIME_PATTERN.test(endTime || '')) {
        return fail('hora_invalida', 'Las horas deben tener el formato HH:mm.');
    }
    if (startTime >= endTime) {
        return fail('hora_invalida', 'La hora de inicio debe ser anterior a la de fin.');
    }
    if (startTime < settings.hora_apertura || endTime > settings.hora_cierre) {
        return fail('fuera_de_horario', `El horario debe estar entre ${settings.hora_apertura} y ${settings.hora_cierre}.`);
    }
    return ok();
};

// A student's class (or a held slot) must sit inside one of the teacher's class windows in that room
const checkInsideClassWindow = ({ availabilities, teacherId, roomId, weekday, startTime, endTime, teacherName, roomName }) => {
    const inside = availabilities.some(a =>
        a.active !== false &&
        a.type === AVAILABILITY_TYPE.CLASE &&
        a.teacherId === teacherId &&
        a.roomId === roomId &&
        a.weekday === weekday &&
        a.startTime <= startTime &&
        endTime <= a.endTime
    );
    if (inside) return ok();
    return fail(
        'fuera_de_franja',
        `El ${WEEKDAY_NAMES[weekday]} de ${startTime} a ${endTime} no está dentro de las franjas de clase de ${teacherName || 'el profesor'} en ${roomName || 'ese salón'}.`
    );
};

module.exports = { TIME_PATTERN, endTimeOf, checkWeeklySlot, checkInsideClassWindow };
