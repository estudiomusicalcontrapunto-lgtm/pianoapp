// Schedule conflicts: the same room at the same time, the same teacher in two
// places, or a student with two lessons at once.
//
// Two kinds of things occupy time:
// - dated lessons (one occurrence, UTC instants)
// - weekly patterns: availability windows, fixed schedules and assessment holds
//
// Every check takes a context with what is already booked:
//   { lessons, fixedSchedules, availabilities, holds, now, roomNames? }
const { LESSON_STATUS, AVAILABILITY_TYPE } = require('./constants');
const { isHoldActive } = require('./holds');
const { localParts, timeToMinutes, minutesToTime, formatRange, toUtc, weekdayPlural } = require('./time');

// The 5th time a weekday falls in a month is always on day 29, 30 or 31
const isFifthWeek = (date) => Number(date.slice(8, 10)) >= 29;

// Lessons that still hold their slot. Cancelled or moved ones free it.
const OCCUPYING_STATUSES = [LESSON_STATUS.PROGRAMADA, LESSON_STATUS.TOMADA, LESSON_STATUS.PERDIDA];
const isOccupying = (lesson) => OCCUPYING_STATUSES.includes(lesson.status);

// Only active make-up windows hold time; classes are scheduled directly, without class windows
const blockingWindows = (ctx) =>
    (ctx.availabilities || []).filter(w => w.active !== false && w.type === AVAILABILITY_TYPE.REPOSICION);

// Half-open intervals [start, end)
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

// Date ranges with optional ends ('YYYY-MM-DD' strings; null = open)
const rangesOverlap = (aFrom, aTo, bFrom, bTo) =>
    (!aTo || !bFrom || bFrom <= aTo) && (!bTo || !aFrom || aFrom <= bTo);

const inRange = (date, from, to) => (!from || from <= date) && (!to || date <= to);

// Normalizes the weekly things to { weekday, start, end, validFrom, validTo } in minutes
const weeklyOfAvailability = (a) => ({
    weekday: a.weekday, start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime), validFrom: null, validTo: null,
});
const weeklyOfFixed = (f) => {
    const start = timeToMinutes(f.startTime);
    return { weekday: f.weekday, start, end: start + f.durationMinutes, validFrom: f.validFrom, validTo: f.validTo || null };
};
const weeklyOfHold = (h) => {
    const start = timeToMinutes(h.holdStartTime);
    return { weekday: h.holdWeekday, start, end: start + h.holdDurationMinutes, validFrom: null, validTo: null };
};

const describeWeekly = (w) => `los ${weekdayPlural(w.weekday)} de ${minutesToTime(w.start)} a ${minutesToTime(w.end)}`;

const buildConflict = (type, source, when, ctx, roomId) => {
    const roomName = (roomId && ctx.roomNames?.[roomId]) || 'El salón';
    let message;
    if (type === 'salon' && source === 'cupo_apartado') {
        message = `${roomName} está apartado para una valoración ${when}.`;
    } else if (type === 'salon') {
        message = `${roomName} ya está ocupado ${when}.`;
    } else if (type === 'profesor' && source === 'cupo_apartado') {
        message = `El profesor tiene un cupo apartado para una valoración ${when}.`;
    } else if (type === 'profesor' && source === 'franja') {
        message = `El profesor ya tiene otra franja ${when}.`;
    } else if (type === 'profesor') {
        message = `El profesor ya tiene otra clase ${when}.`;
    } else {
        message = `El estudiante ya tiene otra clase ${when}.`;
    }
    return { type, source, message };
};

// Which of room / teacher / student two bookings share, in priority order
const sharedResource = (a, b) => {
    if (a.roomId && a.roomId === b.roomId) return 'salon';
    if (a.teacherId && a.teacherId === b.teacherId) return 'profesor';
    if (a.studentId && a.studentId === b.studentId) return 'estudiante';
    return null;
};

// A lesson with a substitute also takes the substitute's time
const sharedWithLesson = (candidate, lesson) =>
    sharedResource(candidate, lesson) ||
    (candidate.teacherId && candidate.teacherId === lesson.substituteTeacherId ? 'profesor' : null);

// Does a dated interval fall on a weekly pattern?
const datedHitsWeekly = (startsAt, endsAt, weekly) => {
    const start = localParts(startsAt);
    if (start.weekday !== weekly.weekday || !inRange(start.date, weekly.validFrom, weekly.validTo)) return false;
    const startMin = timeToMinutes(start.time);
    const endMin = startMin + Math.round((new Date(endsAt) - new Date(startsAt)) / 60000);
    return overlaps(startMin, endMin, weekly.start, weekly.end);
};

// A fixed schedule stops blocking a date once that student's lesson in that
// slot was cancelled or moved (e.g. the teacher cancelled it).
const fixedScheduleFreedOn = (fixed, date, lessons) => {
    const slotStart = toUtc(date, fixed.startTime).getTime();
    return lessons.some(l =>
        l.studentId === fixed.studentId &&
        new Date(l.startsAt).getTime() === slotStart &&
        !isOccupying(l)
    );
};

/**
 * Conflict for one dated booking (a lesson or a make-up).
 * candidate: { startsAt, endsAt, roomId, teacherId, studentId, ignoreLessonIds? }
 * Returns null or { type: 'salon'|'profesor'|'estudiante', source, message }.
 */
const findDatedConflict = (candidate, ctx) => {
    const ignore = new Set(candidate.ignoreLessonIds || []);
    const start = new Date(candidate.startsAt);
    const end = new Date(candidate.endsAt);
    const when = `el ${formatRange(start, end)}`;
    const date = localParts(start).date;

    for (const lesson of ctx.lessons || []) {
        if (ignore.has(lesson.id) || !isOccupying(lesson)) continue;
        if (!overlaps(start, end, new Date(lesson.startsAt), new Date(lesson.endsAt))) continue;
        const type = sharedWithLesson(candidate, lesson);
        if (type) return buildConflict(type, 'clase', when, ctx, candidate.roomId);
    }

    for (const fixed of ctx.fixedSchedules || []) {
        if (!datedHitsWeekly(start, end, weeklyOfFixed(fixed))) continue;
        if (fixedScheduleFreedOn(fixed, date, ctx.lessons || [])) continue;
        // The 5th week of a month has no class: that time is a make-up slot (unless a lesson was booked there)
        if (ctx.fifthWeekFree && isFifthWeek(date)) continue;
        const type = sharedResource(candidate, fixed);
        if (type) return buildConflict(type, 'horario_fijo', when, ctx, candidate.roomId);
    }

    for (const hold of ctx.holds || []) {
        if (!isHoldActive(hold, ctx.now)) continue;
        if (!datedHitsWeekly(start, end, weeklyOfHold(hold))) continue;
        const type = sharedResource(candidate, { roomId: hold.holdRoomId, teacherId: hold.teacherId });
        if (type) return buildConflict(type, 'cupo_apartado', when, ctx, candidate.roomId);
    }

    // Another teacher's make-up window in this room keeps the room for that teacher
    for (const window of blockingWindows(ctx)) {
        if (window.teacherId === candidate.teacherId) continue;
        if (window.roomId !== candidate.roomId) continue;
        if (datedHitsWeekly(start, end, weeklyOfAvailability(window))) {
            return buildConflict('salon', 'franja', when, ctx, candidate.roomId);
        }
    }

    return null;
};

/**
 * Conflict for a weekly pattern being created or edited.
 * candidate: { kind: 'availability'|'fixed'|'hold', id?, weekday, startTime, endTime,
 *              roomId, teacherId, studentId?, validFrom?, validTo? }
 * windowsYield: for a fixed class, make-up windows do not block (it takes them over).
 */
const findWeeklyConflict = (candidate, ctx, { windowsYield = false } = {}) => {
    const weekly = {
        weekday: candidate.weekday,
        start: timeToMinutes(candidate.startTime),
        end: timeToMinutes(candidate.endTime),
        validFrom: candidate.validFrom || null,
        validTo: candidate.validTo || null,
    };
    const when = describeWeekly(weekly);
    const isWindow = candidate.kind === 'availability';
    const hits = (other) =>
        other.weekday === weekly.weekday &&
        overlaps(weekly.start, weekly.end, other.start, other.end) &&
        rangesOverlap(weekly.validFrom, weekly.validTo, other.validFrom, other.validTo);

    // windowsYield: a fixed class takes make-up windows over (see makeupWindows.js), they do not block it
    const windows = windowsYield && candidate.kind === 'fixed' ? [] : blockingWindows(ctx);
    for (const window of windows) {
        if (isWindow && window.id === candidate.id) continue;
        if (!hits(weeklyOfAvailability(window))) continue;
        if (window.roomId === candidate.roomId && window.teacherId !== candidate.teacherId) {
            return buildConflict('salon', 'franja', when, ctx, candidate.roomId);
        }
        // A teacher's make-up window is time they keep free: no other window or regular class then
        if (window.teacherId === candidate.teacherId) {
            return buildConflict('profesor', 'franja', when, ctx, candidate.roomId);
        }
    }

    for (const fixed of ctx.fixedSchedules || []) {
        if (candidate.kind === 'fixed' && fixed.id === candidate.id) continue;
        if (!hits(weeklyOfFixed(fixed))) continue;
        if (isWindow) {
            if (fixed.teacherId === candidate.teacherId) {
                return buildConflict('profesor', 'horario_fijo', when, ctx, candidate.roomId);
            }
            if (fixed.roomId === candidate.roomId) {
                return buildConflict('salon', 'horario_fijo', when, ctx, candidate.roomId);
            }
            continue;
        }
        const type = sharedResource(candidate, fixed);
        if (type) return buildConflict(type, 'horario_fijo', when, ctx, candidate.roomId);
    }

    for (const hold of ctx.holds || []) {
        if (candidate.kind === 'hold' && hold.id === candidate.id) continue;
        if (!isHoldActive(hold, ctx.now) || !hits(weeklyOfHold(hold))) continue;
        const holder = { roomId: hold.holdRoomId, teacherId: hold.teacherId };
        if (isWindow) {
            if (holder.roomId === candidate.roomId && holder.teacherId !== candidate.teacherId) {
                return buildConflict('salon', 'cupo_apartado', when, ctx, candidate.roomId);
            }
            continue;
        }
        const type = sharedResource(candidate, holder);
        if (type) return buildConflict(type, 'cupo_apartado', when, ctx, candidate.roomId);
    }

    // Future dated lessons already booked on that weekday (make-ups, generated lessons)
    for (const lesson of ctx.lessons || []) {
        if (!isOccupying(lesson) || new Date(lesson.startsAt) < new Date(ctx.now)) continue;
        if (!datedHitsWeekly(lesson.startsAt, lesson.endsAt, weekly)) continue;
        if (isWindow) {
            if (lesson.roomId === candidate.roomId && lesson.teacherId !== candidate.teacherId) {
                return buildConflict('salon', 'clase', `el ${formatRange(lesson.startsAt, lesson.endsAt)}`, ctx, candidate.roomId);
            }
            continue;
        }
        const type = sharedWithLesson(candidate, lesson);
        if (type) return buildConflict(type, 'clase', `el ${formatRange(lesson.startsAt, lesson.endsAt)}`, ctx, candidate.roomId);
    }

    return null;
};

module.exports = {
    isFifthWeek,
    OCCUPYING_STATUSES,
    isOccupying,
    overlaps,
    rangesOverlap,
    findDatedConflict,
    findWeeklyConflict,
};
