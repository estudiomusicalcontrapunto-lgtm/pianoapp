// Rooms and make-up windows ("horarios de reposición").
//
// A fixed class is worth more than a make-up window: a new weekly class may
// take the free time of any teacher's make-up window, without asking. The
// window shrinks (or disappears) and its teacher is told. But a make-up a
// student already booked there is respected: then the class cannot go there.
// Two classes in the same room at the same time are never allowed (see conflicts.js).
const { AVAILABILITY_TYPE } = require('./constants');
const { ok, fail } = require('./errors');
const { isOccupying, overlaps } = require('./conflicts');
const { timeToMinutes, minutesToTime, localParts, formatInstant, weekdayPlural } = require('./time');

const isActiveWindow = (w) => w.type === AVAILABILITY_TYPE.REPOSICION && w.active !== false;

// The candidate and the window use the same room, or the same teacher (who cannot be in two places)
const sharesResource = (candidate, window) => window.roomId === candidate.roomId || window.teacherId === candidate.teacherId;

// [start, end) of a window minus [cutStart, cutEnd), as 'HH:mm' ranges
const subtractRange = (window, cutStart, cutEnd) => {
    const start = timeToMinutes(window.startTime);
    const end = timeToMinutes(window.endTime);
    const pieces = [];
    if (cutStart > start) pieces.push([start, Math.min(cutStart, end)]);
    if (cutEnd < end) pieces.push([Math.max(cutEnd, start), end]);
    return pieces.filter(([a, b]) => b > a).map(([a, b]) => ({ startTime: minutesToTime(a), endTime: minutesToTime(b) }));
};

/**
 * A new weekly class over make-up windows.
 * candidate: { weekday, startTime, endTime, roomId, teacherId, validFrom }
 * windows: availabilities (any teacher); lessons: dated lessons already booked.
 * Returns ok({ windowChanges: [{ window, remaining: [{ startTime, endTime }] }] })
 * (remaining empty = the window disappears), or a failure if a student is
 * booked in the part of a window the class needs.
 */
const planClassOverWindows = ({ candidate, windows, lessons, now, teacherNames = {} }) => {
    const classStart = timeToMinutes(candidate.startTime);
    const classEnd = timeToMinutes(candidate.endTime);
    const windowChanges = [];

    for (const window of windows.filter(isActiveWindow)) {
        if (window.weekday !== candidate.weekday || !sharesResource(candidate, window)) continue;
        if (!overlaps(classStart, classEnd, timeToMinutes(window.startTime), timeToMinutes(window.endTime))) continue;

        const booked = lessons.find(l => {
            if (l.availabilityId !== window.id || !isOccupying(l) || new Date(l.startsAt) < new Date(now)) return false;
            const { date, time } = localParts(l.startsAt);
            if (candidate.validFrom && date < candidate.validFrom) return false;
            const start = timeToMinutes(time);
            const end = start + Math.round((new Date(l.endsAt) - new Date(l.startsAt)) / 60000);
            return overlaps(classStart, classEnd, start, end);
        });
        if (booked) {
            const owner = teacherNames[window.teacherId] ? ` de ${teacherNames[window.teacherId]}` : '';
            return fail(
                'reposicion_agendada',
                `Ese horario es una franja de reposición${owner} y ya hay un estudiante agendado ahí el ${formatInstant(booked.startsAt)}. Elige otro horario.`,
                409
            );
        }
        windowChanges.push({ window, remaining: subtractRange(window, classStart, classEnd) });
    }
    return ok({ windowChanges });
};

/**
 * Upcoming make-ups booked in a window that would be left out if the window is
 * removed (after = null) or changed to `after` ({ roomId, weekday, startTime, endTime }).
 * A window with make-ups booked ahead can only be removed or changed once
 * those classes are moved or cancelled (decided 2026-11-26).
 */
const bookedMakeupsLeftOut = ({ window, after = null, lessons, now }) =>
    lessons
        .filter(l => l.availabilityId === window.id && isOccupying(l) && new Date(l.endsAt) > new Date(now))
        .filter(l => {
            if (!after) return true;
            const { weekday, time } = localParts(l.startsAt);
            const end = timeToMinutes(time) + Math.round((new Date(l.endsAt) - new Date(l.startsAt)) / 60000);
            return !(l.roomId === after.roomId && weekday === Number(after.weekday)
                && timeToMinutes(after.startTime) <= timeToMinutes(time) && end <= timeToMinutes(after.endTime));
        })
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

// Message for the teacher who loses (part of) a make-up window
const describeWindowLoss = ({ window, remaining }) => {
    const day = weekdayPlural(window.weekday);
    const lost = `Tu horario de reposición de los ${day} de ${window.startTime} a ${window.endTime}`;
    if (!remaining.length) return `${lost} lo ocupó una clase fija nueva, así que ya no está disponible.`;
    return `${lost} lo ocupó en parte una clase fija nueva. Queda ${remaining.map(r => `de ${r.startTime} a ${r.endTime}`).join(' y ')}.`;
};

module.exports = { planClassOverWindows, subtractRange, describeWindowLoss, bookedMakeupsLeftOut };
