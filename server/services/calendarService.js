// Weekly calendar of one room (lunes a sábado). The academy sees everything;
// a teacher sees their own items and only "Ocupado" for other teachers' time,
// without names.
const { User, Room, TeacherRoom } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { isOccupying, isFifthWeek } = require('../domain/conflicts');
const { isHoldActive } = require('../domain/holds');
const { addDays, toUtc, weekdayOf, localParts, addMinutes } = require('../domain/time');
const { loadScheduleContext } = require('./scheduleContext');
const { getSettings } = require('./settingsService');
const { classLabels } = require('./lessonLabels');

// Monday of the week that contains date
const mondayOf = (date) => addDays(date, 1 - weekdayOf(date));

const buildRoomWeek = async ({ roomId, date, viewer, now = new Date() }) => {
    const room = await Room.findByPk(roomId);
    if (!room) throw new DomainError('salon_no_encontrado', 'Salón no encontrado.', 404);
    if (viewer.role === ROLES.TEACHER) {
        const assigned = await TeacherRoom.findOne({ where: { teacherId: viewer.id, roomId } });
        if (!assigned) throw new DomainError('sin_permiso', 'Ese salón no está asignado a ti.', 403);
    } else if (viewer.role !== ROLES.ACADEMY) {
        throw new DomainError('sin_permiso', 'No tienes acceso a este calendario.', 403);
    }

    const weekStart = mondayOf(date || localParts(now).date);
    const days = [0, 1, 2, 3, 4, 5].map(i => addDays(weekStart, i));
    const from = toUtc(weekStart);
    const to = toUtc(addDays(weekStart, 7));
    const ctx = await loadScheduleContext({ roomIds: [roomId], from, to }, { now });
    const settings = await getSettings();

    const userIds = new Set([
        ...ctx.lessons.map(l => l.studentId), ...ctx.lessons.map(l => l.teacherId), ...ctx.lessons.map(l => l.substituteTeacherId),
        ...ctx.fixedSchedules.map(f => f.studentId), ...ctx.fixedSchedules.map(f => f.teacherId),
        ...ctx.availabilities.map(a => a.teacherId), ...ctx.holds.map(h => h.teacherId),
    ]);
    const users = await User.findAll({ where: { id: [...userIds].filter(Boolean) }, attributes: ['id', 'name'] });
    const nameOf = Object.fromEntries(users.map(u => [u.id, u.name]));

    const blocks = [];
    const dayOf = Object.fromEntries(days.map(d => [weekdayOf(d), d]));

    // Only make-up windows are shown; old class windows are no longer used
    for (const window of ctx.availabilities.filter(a => a.roomId === roomId && a.type === 'reposicion')) {
        const day = dayOf[window.weekday];
        if (!day) continue;
        blocks.push({
            id: `franja:${window.id}:${day}`,
            kind: window.type === 'reposicion' ? 'franja_reposicion' : 'franja_clase',
            sourceId: window.id,
            teacherId: window.teacherId,
            teacherName: nameOf[window.teacherId],
            startsAt: toUtc(day, window.startTime),
            endsAt: toUtc(day, window.endTime),
            capacity: window.capacity,
        });
    }

    const roomLessons = ctx.lessons.filter(l => l.roomId === roomId);
    const labelOf = await classLabels(roomLessons);
    for (const lesson of roomLessons) {
        blocks.push({
            id: `clase:${lesson.id}`,
            kind: 'clase',
            lessonId: lesson.id,
            lessonKind: lesson.kind,
            status: lesson.status,
            teacherId: lesson.teacherId,
            teacherName: nameOf[lesson.teacherId],
            studentId: lesson.studentId,
            studentName: nameOf[lesson.studentId],
            substituteTeacherId: lesson.substituteTeacherId,
            substituteLabel: (lesson.substituteTeacherId ? nameOf[lesson.substituteTeacherId] : lesson.substituteName) || null,
            moved: !!lesson.moved,
            paymentId: lesson.paymentId || null,
            // "Clase 2 de 4", "Clase suelta", "Reposición de la clase 2"
            classLabel: labelOf.get(lesson.id) || null,
            startsAt: lesson.startsAt,
            endsAt: lesson.endsAt,
        });
    }

    // Fixed schedules of students whose lesson for that day does not exist yet
    // (cycle not paid or not created): shown as the expected class
    for (const fixed of ctx.fixedSchedules.filter(f => f.roomId === roomId)) {
        const day = dayOf[fixed.weekday];
        if (!day || fixed.validFrom > day || (fixed.validTo && fixed.validTo < day)) continue;
        const startsAt = toUtc(day, fixed.startTime);
        const hasLesson = ctx.lessons.some(l => l.studentId === fixed.studentId && new Date(l.startsAt).getTime() === startsAt.getTime());
        if (hasLesson) continue;
        // 5th week of the month: no class, the time is a make-up slot of the teacher
        if (ctx.fifthWeekFree && isFifthWeek(day)) {
            blocks.push({
                id: `quinta:${fixed.id}:${day}`,
                kind: 'franja_reposicion',
                sourceId: null,
                teacherId: fixed.teacherId,
                teacherName: nameOf[fixed.teacherId],
                label: 'Semana 5: cupo de reposición',
                startsAt,
                endsAt: addMinutes(startsAt, fixed.durationMinutes),
                capacity: 1,
            });
            continue;
        }
        blocks.push({
            id: `fijo:${fixed.id}:${day}`,
            kind: 'horario_fijo',
            sourceId: fixed.id,
            teacherId: fixed.teacherId,
            teacherName: nameOf[fixed.teacherId],
            studentId: fixed.studentId,
            studentName: nameOf[fixed.studentId],
            startsAt,
            endsAt: addMinutes(startsAt, fixed.durationMinutes),
        });
    }

    for (const hold of ctx.holds.filter(h => h.holdRoomId === roomId && isHoldActive(h, now))) {
        const day = dayOf[hold.holdWeekday];
        if (!day) continue;
        const startsAt = toUtc(day, hold.holdStartTime);
        blocks.push({
            id: `apartado:${hold.id}:${day}`,
            kind: 'cupo_apartado',
            sourceId: hold.id,
            teacherId: hold.teacherId,
            teacherName: nameOf[hold.teacherId],
            studentName: hold.studentName,
            expiresAt: hold.holdExpiresAt,
            startsAt,
            endsAt: addMinutes(startsAt, hold.holdDurationMinutes),
        });
    }

    // A substitute sees the lessons they cover as their own
    const isOwn = (b) => b.teacherId === viewer.id || (b.kind === 'clase' && b.substituteTeacherId === viewer.id);
    const visible = viewer.role === ROLES.ACADEMY
        ? blocks
        : blocks
            .filter(b => isOwn(b) || b.kind !== 'clase' || isOccupying(b))
            .map(b => (isOwn(b)
                ? b
                : { id: b.id, kind: 'ocupado', startsAt: b.startsAt, endsAt: b.endsAt, label: 'Ocupado' }));

    return {
        room: { id: room.id, name: room.name },
        weekStart,
        days,
        closures: ctx.closures.filter(c => days.includes(c.date)),
        hours: { open: settings.hora_apertura, close: settings.hora_cierre },
        blocks: visible.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
    };
};

module.exports = { buildRoomWeek, mondayOf };
