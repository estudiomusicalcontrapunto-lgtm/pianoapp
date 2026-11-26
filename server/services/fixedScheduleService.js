// Students' recurring weekly classes. The teacher places them directly on the
// calendar; they are checked against every other weekly or dated booking.
const { Op } = require('sequelize');
const { FixedSchedule, TeacherRoom, User, Room, Cycle, Lesson, Availability } = require('../models');
const { ROLES, CYCLE_STATUS, LESSON_STATUS, LESSON_KIND } = require('../domain/constants');
const { DomainError, assertOk } = require('../domain/errors');
const { canManageTeacherAgenda } = require('../domain/permissions');
const { findWeeklyConflict, findDatedConflict } = require('../domain/conflicts');
const { planClassOverWindows, describeWindowLoss } = require('../domain/makeupWindows');
const { createNotice } = require('./noticeService');
const { checkWeeklySlot, endTimeOf } = require('../domain/schedules');
const { scheduleUnscheduledCycles } = require('./cycleService');
const { addDays, addMinutes, localDate, toUtc, weekdayOf, monthOf, firstDayOfMonth, addMonths } = require('../domain/time');
const { planWeeklyTime, fillChargedMonths } = require('./billingService');
const { loadScheduleContext } = require('./scheduleContext');
const { runBookingTransaction } = require('./bookingTransaction');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./audit');

// How far ahead dated lessons are checked against a new weekly slot
const LOOKAHEAD_DAYS = 120;

/**
 * Checks a weekly slot for a teacher/room (and optionally a student).
 * kind: 'fixed' | 'hold'; ignore: { fixedId, holdId, lessonIds } when editing or converting.
 */
const validateWeeklyBooking = async ({ kind, teacherId, roomId, studentId, weekday, startTime, durationMinutes, validFrom, validTo, ignore = {} }, { transaction, now }) => {
    const settings = await getSettings({ transaction });
    const endTime = endTimeOf(startTime, durationMinutes);
    assertOk(checkWeeklySlot({ weekday, startTime, endTime, settings }));

    const [teacher, room] = await Promise.all([
        User.findByPk(teacherId, { transaction }),
        Room.findByPk(roomId, { transaction }),
    ]);
    if (!teacher || teacher.role !== ROLES.TEACHER) throw new DomainError('profesor_invalido', 'El profesor no existe.');
    if (!room || !room.active) throw new DomainError('salon_invalido', 'El salón no existe o está inactivo.');
    const assigned = await TeacherRoom.findOne({ where: { teacherId, roomId }, transaction });
    if (!assigned) throw new DomainError('salon_no_asignado', `${room.name} no está asignado a ${teacher.name}.`);

    const from = new Date(now);
    const ctx = await loadScheduleContext({
        roomIds: [roomId], teacherIds: [teacherId], studentIds: studentId ? [studentId] : [],
        from, to: toUtc(addDays(localDate(now), LOOKAHEAD_DAYS)),
    }, { transaction, now });

    const candidate = {
        kind,
        id: kind === 'fixed' ? ignore.fixedId : ignore.holdId,
        weekday, startTime, endTime, roomId, teacherId, studentId, validFrom, validTo,
    };
    const others = {
        ...ctx,
        // The hold being converted must not block its own conversion,
        // nor the lessons being moved along with a schedule change
        holds: ctx.holds.filter(h => h.id !== ignore.holdId),
        lessons: ctx.lessons.filter(l => !(ignore.lessonIds || []).includes(l.id)),
    };
    // A fixed class takes over free make-up windows (of any teacher); they shrink
    // afterwards. A student booked there is respected (checked first, for a clear message).
    let windowChanges = [];
    if (kind === 'fixed') {
        const owners = await User.findAll({ where: { id: [...new Set(ctx.availabilities.map(w => w.teacherId))] }, attributes: ['id', 'name'], transaction });
        const plan = assertOk(planClassOverWindows({
            candidate, windows: ctx.availabilities, lessons: others.lessons, now,
            teacherNames: Object.fromEntries(owners.map(o => [o.id, o.name])),
        }));
        windowChanges = plan.windowChanges;
    }
    const conflict = findWeeklyConflict(candidate, others, { windowsYield: kind === 'fixed' });
    if (conflict) throw new DomainError(`choque_${conflict.type}`, conflict.message, 409, conflict);
    return { teacher, room, endTime, windowChanges };
};

/**
 * Shrinks (or turns off) the make-up windows a new fixed class took over and
 * tells their teachers. A window cut in the middle becomes two.
 */
const applyWindowChanges = async (windowChanges, { actor, transaction }) => {
    for (const { window, remaining } of windowChanges) {
        const row = await Availability.findByPk(window.id, { transaction });
        if (!row) continue;
        const before = { startTime: row.startTime, endTime: row.endTime };
        if (!remaining.length) {
            await row.update({ active: false }, { transaction });
        } else {
            await row.update(remaining[0], { transaction });
            for (const piece of remaining.slice(1)) {
                await Availability.create({
                    teacherId: row.teacherId, roomId: row.roomId, weekday: row.weekday, type: row.type, capacity: row.capacity, ...piece,
                }, { transaction });
            }
        }
        await logAudit({
            entityType: 'availability', entityId: row.id, action: 'ocupada_por_clase_fija', actorId: actor?.id,
            details: { before, remaining },
        }, { transaction });
        await createNotice({
            category: 'franja_ocupada',
            title: 'Horario de reposición ocupado',
            message: describeWindowLoss({ window, remaining }),
            recipientIds: [row.teacherId],
            authorId: actor?.id || null,
        }, { transaction });
    }
};

const createFixedSchedule = async (data, { actor, transaction, now = new Date(), ignoreHoldId } = {}) => {
    const student = await User.findByPk(data.studentId, { transaction });
    if (!student || student.role !== ROLES.STUDENT) throw new DomainError('estudiante_invalido', 'El estudiante no existe.');
    if (student.teacherId !== data.teacherId) {
        throw new DomainError('profesor_no_asignado', 'El estudiante no está asignado a ese profesor.');
    }
    const durationMinutes = data.durationMinutes || (await getSettings({ transaction })).duracion_clase_minutos;
    const validFrom = data.validFrom || localDate(now);
    const { windowChanges } = await validateWeeklyBooking({
        kind: 'fixed', ...data, durationMinutes, validFrom, ignore: { holdId: ignoreHoldId },
    }, { transaction, now });

    const fixed = await FixedSchedule.create({ ...data, durationMinutes, validFrom }, { transaction });
    await applyWindowChanges(windowChanges, { actor, transaction });
    await logAudit({
        entityType: 'fixed_schedule', entityId: fixed.id, action: 'crear', actorId: actor?.id,
        details: { weekday: fixed.weekday, startTime: fixed.startTime, roomId: fixed.roomId },
    }, { transaction });
    return fixed;
};

/**
 * From the teacher's agenda (or the academy): the student's weekly class.
 * The teacher never creates charges (the academy does). The weekly time fills
 * with the classes of the months the academy already charged and approved that
 * still have none, from that month's first week (see billingService.planWeeklyTime);
 * a month charged but not approved yet waits (awaitingPayment), and without a
 * charge the time is kept (needsCharge): the classes come when the payment is approved.
 * A student with a paid 4-week cycle still gets that cycle's classes (old billing).
 * Returns { fixed, scheduled, firstClassAt, months, awaitingPayment, needsCharge, lessons }.
 * With dryRun nothing is saved: the same answer, so the teacher sees where
 * the classes go before confirming (preview: true).
 */
class DryRun extends Error {
    constructor(result) {
        super('dry-run');
        this.result = result;
    }
}

const addFixedSchedule = async ({ data, actor, now = new Date(), dryRun = false }) => {
    if (!canManageTeacherAgenda(actor, data.teacherId)) {
        throw new DomainError('sin_permiso', 'Solo puedes asignar horarios a tus estudiantes.', 403);
    }
    // eslint-disable-next-line no-unused-vars
    const { startChoice, ...fields } = data;
    try {
        return await runAddFixedSchedule({ fields, actor, now, dryRun });
    } catch (error) {
        if (error instanceof DryRun) return { ...error.result, preview: true };
        throw error;
    }
};

const runAddFixedSchedule = ({ fields, actor, now, dryRun }) =>
    runBookingTransaction({ roomIds: [fields.roomId], userIds: [fields.teacherId, fields.studentId] }, async (transaction) => {
        const student = await User.findByPk(fields.studentId, { transaction });
        if (!student || student.role !== ROLES.STUDENT || student.teacherId !== fields.teacherId) {
            throw new DomainError('profesor_no_asignado', 'El estudiante no está asignado a ese profesor.');
        }
        // validFrom is the day the teacher tapped: the first class is that day, not the next week
        const validFrom = fields.validFrom || localDate(now);
        const weekday = Number(fields.weekday);
        const firstSlotPassed = weekdayOf(validFrom) === weekday && toUtc(validFrom, fields.startTime) <= new Date(now);
        if (validFrom < localDate(now) || firstSlotPassed) {
            throw new DomainError('fecha_pasada', 'Ese horario ya pasó. Elige un día y hora desde ahora en adelante.');
        }
        const paidCycle = await Cycle.findOne({ where: { studentId: student.id, status: CYCLE_STATUS.ACTIVO }, transaction });

        let fixed;
        let scheduled = 0;
        let months = [];
        let waiting = [];
        let lessons = [];
        if (paidCycle) {
            fixed = await createFixedSchedule({ ...fields, weekday, validFrom }, { actor, transaction, now });
            scheduled = await scheduleUnscheduledCycles(student.id, { actor, now, transaction, from: validFrom });
        } else {
            const plan = await planWeeklyTime({ student, weekday, startTime: fields.startTime, tappedDate: validFrom, now, transaction });
            fixed = await createFixedSchedule({ ...fields, weekday, validFrom: plan.validFrom }, { actor, transaction, now });
            months = plan.months;
            waiting = plan.waiting;
            lessons = await fillChargedMonths({ student, months, validFrom: plan.validFrom, transaction });
            scheduled = lessons.length;
        }
        // So the agenda can jump to the week of the first class
        const firstLesson = await Lesson.findOne({
            where: { studentId: student.id, status: LESSON_STATUS.PROGRAMADA, startsAt: { [Op.gt]: new Date(now) } },
            order: [['startsAt', 'ASC']],
            transaction,
        });
        const result = {
            fixed: fixed.get({ plain: true }),
            scheduled,
            firstClassAt: firstLesson ? firstLesson.startsAt : null,
            months,
            // Charged months whose payment the academy has not approved yet: their classes come on approval
            awaitingPayment: waiting,
            // No charged month to fill: the classes come when the academy charges
            needsCharge: !paidCycle && !months.length && !waiting.length,
            tappedDate: validFrom,
            lessons: lessons.map(l => ({ startsAt: l.startsAt, period: l.period })).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
        };
        if (dryRun) throw new DryRun(result);
        return result;
    });

// Same week, new day and time; a slot that already passed goes to the next week
const shiftToSchedule = (lesson, { weekday, startTime, durationMinutes }, now) => {
    const date = localDate(lesson.startsAt);
    const monday = addDays(date, 1 - weekdayOf(date));
    let startsAt = toUtc(addDays(monday, weekday - 1), startTime);
    if (startsAt <= new Date(now)) startsAt = addMinutes(startsAt, 7 * 24 * 60);
    return { startsAt, endsAt: addMinutes(startsAt, durationMinutes) };
};

/**
 * Changes a student's weekly class.
 * - moveUpcoming (the usual case: a mistake or a new time): the change applies
 *   from today and the weekly classes already scheduled move to the new day and
 *   time, each in its own week. With fromLessonId (the teacher tapped a class and
 *   chose "Cambiar el horario de todas las semanas") only that class and the next
 *   ones move, and the change applies from that class's week; earlier ones stay.
 *   Single classes (paid apart) and make-ups never move with the weekly time.
 * - otherwise it applies from effectiveFrom (default: after the paid cycle in
 *   course) and the classes already scheduled keep their date.
 * Returns { fixed, movedLessons }.
 */
const changeFixedSchedule = async ({ id, data, actor, now = new Date() }) => {
    const existing = await FixedSchedule.findByPk(id);
    if (!existing) throw new DomainError('horario_no_encontrado', 'Horario fijo no encontrado.', 404);
    if (!canManageTeacherAgenda(actor, existing.teacherId)) {
        throw new DomainError('sin_permiso', 'Solo puedes cambiar horarios de tus estudiantes.', 403);
    }
    const moveUpcoming = !!data.moveUpcoming;
    // The class the teacher tapped: it and the next ones move, the earlier ones stay
    let fromLesson = null;
    if (moveUpcoming && data.fromLessonId) {
        fromLesson = await Lesson.findByPk(data.fromLessonId);
        if (!fromLesson || fromLesson.studentId !== existing.studentId || fromLesson.teacherId !== existing.teacherId) {
            throw new DomainError('clase_invalida', 'Esa clase no es de este horario.');
        }
        if (new Date(fromLesson.startsAt) <= new Date(now)) {
            throw new DomainError('clase_pasada', 'Esa clase ya empezó. Elige una clase que todavía no haya pasado.');
        }
    }
    let effectiveFrom = data.effectiveFrom || localDate(now);
    if (moveUpcoming) {
        effectiveFrom = localDate(now);
        if (fromLesson) {
            const date = localDate(fromLesson.startsAt);
            const monday = addDays(date, 1 - weekdayOf(date));
            if (monday > effectiveFrom) effectiveFrom = monday;
        }
    } else if (!data.effectiveFrom) {
        const active = await Cycle.findOne({
            where: { studentId: existing.studentId, status: CYCLE_STATUS.ACTIVO },
            order: [['endDate', 'DESC']],
        });
        if (active && addDays(active.endDate, 1) > effectiveFrom) effectiveFrom = addDays(active.endDate, 1);
        // Monthly billing: this month's classes are already generated, the change starts next month
        else if (!active && await Lesson.findOne({ where: { studentId: existing.studentId, period: monthOf(localDate(now)) } })) {
            effectiveFrom = firstDayOfMonth(addMonths(monthOf(localDate(now)), 1));
        }
    }
    const next = {
        studentId: existing.studentId,
        teacherId: existing.teacherId,
        roomId: data.roomId || existing.roomId,
        weekday: Number(data.weekday ?? existing.weekday),
        startTime: data.startTime || existing.startTime,
        durationMinutes: Number(data.durationMinutes || existing.durationMinutes),
        validFrom: effectiveFrom > existing.validFrom ? effectiveFrom : existing.validFrom,
        validTo: existing.validTo,
    };

    return runBookingTransaction({ roomIds: [next.roomId, existing.roomId], userIds: [existing.teacherId, existing.studentId] }, async (transaction) => {
        // Weekly classes still ahead, from the tapped one if any (make-ups and single classes keep their own date)
        const upcoming = moveUpcoming
            ? await Lesson.findAll({
                where: {
                    studentId: existing.studentId,
                    teacherId: existing.teacherId,
                    status: LESSON_STATUS.PROGRAMADA,
                    kind: LESSON_KIND.REGULAR,
                    paymentId: null,
                    startsAt: fromLesson ? { [Op.gte]: fromLesson.startsAt } : { [Op.gt]: new Date(now) },
                },
                order: [['startsAt', 'ASC']],
                transaction,
            })
            : [];
        const movedIds = upcoming.map(l => l.id);
        const { windowChanges } = await validateWeeklyBooking({ kind: 'fixed', ...next, ignore: { fixedId: existing.id, lessonIds: movedIds } }, { transaction, now });
        await applyWindowChanges(windowChanges, { actor, transaction });

        if (upcoming.length) {
            const targets = upcoming.map(lesson => ({ lesson, ...shiftToSchedule(lesson, next, now) }));
            const ctx = await loadScheduleContext({
                roomIds: [next.roomId], teacherIds: [existing.teacherId], studentIds: [existing.studentId],
                from: new Date(now), to: targets[targets.length - 1].endsAt,
            }, { transaction, now });
            const others = {
                ...ctx,
                lessons: ctx.lessons.filter(l => !movedIds.includes(l.id)),
                fixedSchedules: ctx.fixedSchedules.filter(f => f.id !== existing.id),
            };
            for (const target of targets) {
                const conflict = findDatedConflict({
                    startsAt: target.startsAt, endsAt: target.endsAt, roomId: next.roomId,
                    teacherId: existing.teacherId, studentId: existing.studentId,
                }, others);
                if (conflict) throw new DomainError(`choque_${conflict.type}`, conflict.message, 409, conflict);
            }
            for (const { lesson, startsAt, endsAt } of targets) {
                const from = lesson.startsAt;
                await lesson.update({ startsAt, endsAt, roomId: next.roomId, changedById: actor.id, changedAt: new Date(now) }, { transaction });
                await logAudit({
                    entityType: 'lesson', entityId: lesson.id, action: 'cambiar_horario', actorId: actor.id,
                    details: { from, to: startsAt },
                }, { transaction });
            }
        }

        let result;
        if (existing.validFrom >= effectiveFrom) {
            result = await existing.update(next, { transaction });
        } else {
            await existing.update({ validTo: addDays(effectiveFrom, -1) }, { transaction });
            result = await FixedSchedule.create(next, { transaction });
        }
        await logAudit({
            entityType: 'fixed_schedule', entityId: result.id, action: 'cambiar', actorId: actor.id,
            details: { previousId: existing.id, weekday: next.weekday, startTime: next.startTime, roomId: next.roomId, effectiveFrom, moved: movedIds.length },
        }, { transaction });
        return { fixed: result.get({ plain: true }), movedLessons: upcoming.map(l => l.get({ plain: true })) };
    });
};

/** Ends a fixed schedule: no class from the day after endDate (default today). */
const endFixedSchedule = async ({ id, actor, endDate, now = new Date() }) => {
    const existing = await FixedSchedule.findByPk(id);
    if (!existing) throw new DomainError('horario_no_encontrado', 'Horario fijo no encontrado.', 404);
    if (!canManageTeacherAgenda(actor, existing.teacherId)) {
        throw new DomainError('sin_permiso', 'Solo puedes cambiar horarios de tus estudiantes.', 403);
    }
    const validTo = endDate || localDate(now);
    if (validTo < existing.validFrom) {
        await existing.destroy();
    } else {
        await existing.update({ validTo });
    }
    await logAudit({ entityType: 'fixed_schedule', entityId: id, action: 'terminar', actorId: actor.id, details: { validTo } });
};

module.exports = { validateWeeklyBooking, createFixedSchedule, addFixedSchedule, changeFixedSchedule, endFixedSchedule };
