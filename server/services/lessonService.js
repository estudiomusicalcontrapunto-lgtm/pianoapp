// Moving, making up, cancelling and grading lessons. Each write re-checks the
// domain rules inside a booking transaction (see bookingTransaction.js).
const { Op } = require('sequelize');
const { sequelize, Lesson, Cycle, User, Availability, TeacherRoom, FixedSchedule } = require('../models');
const { isBlockedByPayment } = require('./billingService');
const { statusFor } = require('./termsService');
const { LESSON_KIND, LESSON_STATUS, AVAILABILITY_TYPE, ROLES } = require('../domain/constants');
const { DomainError, assertOk } = require('../domain/errors');
const { canManageStudentBookings, canManageTeacherAgenda, canBookMakeupAsTeacher } = require('../domain/permissions');
const { findDatedConflict } = require('../domain/conflicts');
const { checkTeacherPresent } = require('../domain/absences');
const {
    lessonMinutes, checkMakeupOwed, checkMakeupTarget, checkWindowSlot,
    listMakeupOptions, listFifthWeekOptions, isFifthWeekSlotOf, checkCancellation, checkAttendance,
} = require('../domain/lessons');
const { checkStudentChange, studentMakeupRange, checkTeacherMove, pendingMakeupDeadline } = require('../domain/classRules');
const { addMinutes, localParts, localDate, addDays, toUtc, monthOf, firstDayOfMonth, lastDayOfMonth } = require('../domain/time');
const { runBookingTransaction } = require('./bookingTransaction');
const { loadScheduleContext } = require('./scheduleContext');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./audit');

const plain = (row) => (row ? row.get({ plain: true }) : row);

const loadLesson = async (lessonId, transaction) => {
    const lesson = await Lesson.findByPk(lessonId, { transaction });
    if (!lesson) throw new DomainError('clase_no_encontrada', 'Clase no encontrada.', 404);
    return lesson;
};

const loadCycleWithLessons = async (cycleId, transaction) => {
    const cycle = await Cycle.findByPk(cycleId, { transaction });
    const cycleLessons = await Lesson.findAll({ where: { cycleId }, transaction });
    return { cycle: plain(cycle), cycleLessons: cycleLessons.map(plain) };
};

const teacherMakeupWindows = (teacherId, transaction) =>
    Availability.findAll({ where: { teacherId, type: AVAILABILITY_TYPE.REPOSICION, active: true }, transaction });

// Widen the loaded range to the whole window occurrence so its capacity is counted right
const windowRange = (window, startsAt, endsAt) => {
    const date = localParts(startsAt).date;
    const from = toUtc(date, window.startTime);
    const to = toUtc(date, window.endTime);
    return { from: from < startsAt ? from : startsAt, to: to > endsAt ? to : endsAt };
};

// Slots on days the lesson's teacher is absent are not offered
const withoutAbsences = (options, lesson, ctx) =>
    options.filter(o => checkTeacherPresent({ absences: ctx.absences, teacherId: lesson.teacherId, startsAt: o.startsAt }).ok);

const assertNoConflict = (candidate, ctx) => {
    const conflict = findDatedConflict(candidate, ctx);
    if (conflict) throw new DomainError(`choque_${conflict.type}`, conflict.message, 409, conflict);
};

// Classes the student already changed in the month of this one (for the optional monthly cap)
const changesInMonthOf = async (lesson, transaction) => {
    const month = monthOf(localDate(lesson.startsAt));
    const from = toUtc(firstDayOfMonth(month));
    const to = toUtc(addDays(lastDayOfMonth(month), 1));
    return Lesson.count({
        where: { studentId: lesson.studentId, status: LESSON_STATUS.REPROGRAMADA_POR_ESTUDIANTE, startsAt: { [Op.gte]: from, [Op.lt]: to } },
        transaction,
    });
};

// The month is unpaid past its deadline: the student can no longer book
// ...and a student who has not accepted the current terms cannot either
const studentChangeRule = async ({ lesson, settings, now, transaction }) => {
    const student = await User.findByPk(lesson.studentId, { transaction });
    return checkStudentChange({
        lesson, now, settings,
        changesThisMonth: await changesInMonthOf(lesson, transaction),
        paymentBlocked: await isBlockedByPayment(lesson.studentId, lesson.period || monthOf(localDate(lesson.startsAt)), { now, transaction }),
        termsPending: !!student && (await statusFor(student, { now })).required === true,
    });
};

/**
 * Options for "Cambiar clase": the free make-up slots of the student's teacher
 * in the month of the class, starting at least horas_minimas_aviso from now.
 * Returns { rule, options, month }: rule says whether the class can be changed (and until when).
 */
const getRescheduleOptions = async ({ lessonId, actor, now = new Date() }) => {
    const lesson = plain(await loadLesson(lessonId));
    const student = await User.findByPk(lesson.studentId);
    if (!canManageStudentBookings(actor, student)) {
        throw new DomainError('sin_permiso', 'No puedes cambiar esta clase.', 403);
    }
    const settings = await getSettings();
    const month = monthOf(localDate(lesson.startsAt));
    const rule = await studentChangeRule({ lesson, settings, now });
    if (!rule.ok) return { rule, options: [], month };

    const range = studentMakeupRange(lesson, now, settings);
    const { cycle } = await loadCycleWithLessons(lesson.cycleId);
    const windows = (await teacherMakeupWindows(lesson.teacherId)).map(plain);
    const ctx = await loadScheduleContext({
        roomIds: windows.map(w => w.roomId),
        teacherIds: [lesson.teacherId],
        studentIds: [lesson.studentId],
        from: new Date(now),
        to: toUtc(addDays(range.toDate, 1)),
    }, { now });

    const params = {
        lesson, cycle, settings, ctx,
        fromDate: localDate(range.from),
        toDate: range.toDate,
        mode: 'cambio',
        closures: ctx.closures,
        ignoreLessonIds: [lesson.id],
    };
    // The teacher's make-up windows, plus their class times in the 5th week of the month
    const options = [...listMakeupOptions({ ...params, windows }), ...listFifthWeekOptions(params)]
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    return { rule, options: withoutAbsences(options, lesson, ctx), month };
};

// Where a changed class can go: a make-up window, or a class time of the teacher in the 5th week
const loadChangeTarget = async ({ availabilityId, fixedScheduleId }) => {
    if (availabilityId) {
        const window = await Availability.findByPk(availabilityId);
        // A removed window keeps the make-ups booked before, but takes no new ones
        if (!window || !window.active) throw new DomainError('franja_invalida', 'Esa franja de reposición ya no existe. Elige otra.', 404);
        return { window, fixed: null, roomId: window.roomId, teacherId: window.teacherId };
    }
    const fixed = fixedScheduleId && await FixedSchedule.findByPk(fixedScheduleId);
    if (!fixed) throw new DomainError('franja_invalida', 'Ese cupo de reposición ya no existe. Elige otro.', 404);
    return { window: null, fixed, roomId: fixed.roomId, teacherId: fixed.teacherId };
};

/**
 * The student (or the academy for them) changes a class to a free make-up slot
 * of their teacher in the same month. No limit (unless the academy set a monthly
 * cap). The new lesson is a reposicion linked to the original: it cannot be changed again.
 */
const rescheduleLesson = async ({ lessonId, actor, availabilityId, fixedScheduleId, startsAt, now = new Date() }) => {
    const draft = await loadLesson(lessonId);
    const target = await loadChangeTarget({ availabilityId, fixedScheduleId });
    const { window, fixed } = target;

    return runBookingTransaction(
        { roomIds: [target.roomId, draft.roomId], userIds: [draft.teacherId, draft.studentId] },
        async (transaction) => {
            const lessonRow = await loadLesson(lessonId, transaction);
            const lesson = plain(lessonRow);
            const student = await User.findByPk(lesson.studentId, { transaction });
            if (!canManageStudentBookings(actor, student)) {
                throw new DomainError('sin_permiso', 'No puedes cambiar esta clase.', 403);
            }
            const settings = await getSettings({ transaction });
            const { cycle } = await loadCycleWithLessons(lesson.cycleId, transaction);
            assertOk(await studentChangeRule({ lesson, settings, now, transaction }));

            if (target.teacherId !== lesson.teacherId) {
                throw new DomainError('franja_invalida', 'Ese cupo no es de tu profesor.');
            }
            const start = new Date(startsAt);
            const end = addMinutes(start, lessonMinutes(lesson));
            const range = window ? windowRange(window, start, end) : { from: start, to: end };
            const ctx = await loadScheduleContext({
                roomIds: [target.roomId], teacherIds: [lesson.teacherId], studentIds: [lesson.studentId], ...range,
            }, { transaction, now });

            assertOk(checkMakeupTarget({ startsAt: start, endsAt: end, mode: 'cambio', cycle, original: lesson, closures: ctx.closures, settings, now }));
            assertOk(checkTeacherPresent({ absences: ctx.absences, teacherId: lesson.teacherId, startsAt: start }));
            if (window) {
                assertOk(checkWindowSlot({ window: plain(window), startsAt: start, endsAt: end, lessons: ctx.lessons }));
            } else if (!ctx.fifthWeekFree || !isFifthWeekSlotOf(plain(fixed), start)) {
                throw new DomainError('franja_invalida', 'Ese horario no es un cupo de reposición.');
            }
            assertNoConflict({
                startsAt: start, endsAt: end, roomId: target.roomId,
                teacherId: lesson.teacherId, studentId: lesson.studentId, ignoreLessonIds: [lesson.id],
            }, ctx);

            const changedAt = new Date(now);
            const makeup = await Lesson.create({
                cycleId: lesson.cycleId,
                period: lesson.period,
                studentId: lesson.studentId,
                teacherId: lesson.teacherId,
                roomId: target.roomId,
                startsAt: start,
                endsAt: end,
                status: LESSON_STATUS.PROGRAMADA,
                kind: LESSON_KIND.REPOSICION,
                originalLessonId: lesson.id,
                availabilityId: window ? window.id : null,
                changedById: actor.id,
                changedAt,
            }, { transaction });

            await lessonRow.update({
                status: LESSON_STATUS.REPROGRAMADA_POR_ESTUDIANTE,
                changedById: actor.id,
                changedAt,
            }, { transaction });

            await logAudit({
                entityType: 'lesson', entityId: lesson.id, action: 'reprogramar',
                fromStatus: LESSON_STATUS.PROGRAMADA, toStatus: LESSON_STATUS.REPROGRAMADA_POR_ESTUDIANTE,
                actorId: actor.id, details: { makeupId: makeup.id },
            }, { transaction });
            await logAudit({
                entityType: 'lesson', entityId: makeup.id, action: 'crear_reposicion',
                toStatus: LESSON_STATUS.PROGRAMADA, actorId: actor.id, details: { originalLessonId: lesson.id },
            }, { transaction });

            return { original: plain(lessonRow), makeup: plain(makeup) };
        }
    );
};

// A make-up owed by the teacher is booked by the teacher (any free time) or the academy, never the student
const makeupBookingMode = (actor, student, lesson) => {
    if (actor.role === ROLES.STUDENT && canManageStudentBookings(actor, student)) {
        throw new DomainError('reposicion_del_profesor', 'La reposición de esta clase la agenda tu profesor. Te avisaremos cuando tenga fecha.', 403);
    }
    if (actor.role === ROLES.ACADEMY || canBookMakeupAsTeacher(actor, lesson)) return 'free';
    throw new DomainError('sin_permiso', 'No puedes agendar la reposición de esta clase.', 403);
};

/** The teacher's make-up windows with room for a lesson they cancelled, until its deadline. */
const getMakeupOptions = async ({ lessonId, actor, now = new Date() }) => {
    const lesson = plain(await loadLesson(lessonId));
    const student = await User.findByPk(lesson.studentId);
    makeupBookingMode(actor, student, lesson);
    const { cycle, cycleLessons } = await loadCycleWithLessons(lesson.cycleId);
    assertOk(checkMakeupOwed(lesson, cycleLessons));

    const settings = await getSettings();
    const fromDate = localDate(now);
    // Until the end of the month after the cancelled class
    const toDate = pendingMakeupDeadline(lesson);
    const windows = (await teacherMakeupWindows(lesson.teacherId)).map(plain);
    const ctx = await loadScheduleContext({
        roomIds: windows.map(w => w.roomId),
        teacherIds: [lesson.teacherId],
        studentIds: [lesson.studentId],
        from: new Date(now),
        to: toUtc(addDays(toDate, 1)),
    }, { now });

    const options = listMakeupOptions({
        lesson, windows, cycle, settings, ctx, fromDate, toDate,
        mode: 'reposicion',
        closures: ctx.closures,
    });
    return { options: withoutAbsences(options, lesson, ctx) };
};

/**
 * Book the make-up for a lesson the teacher (or the academy) cancelled. The
 * teacher or the academy books it, in any free time in one of the teacher's
 * rooms, until the end of the month after the cancelled class.
 * target: { availabilityId } or { roomId } plus startsAt.
 */
const bookMakeup = async ({ lessonId, actor, availabilityId, roomId, startsAt, now = new Date() }) => {
    const draft = await loadLesson(lessonId);
    const window = availabilityId ? await Availability.findByPk(availabilityId) : null;
    if (availabilityId && (!window || !window.active)) throw new DomainError('franja_invalida', 'Esa franja de reposición ya no existe. Elige otra.', 404);
    const targetRoomId = window ? window.roomId : roomId;
    if (!targetRoomId) throw new DomainError('salon_requerido', 'Indica el salón de la reposición.');

    return runBookingTransaction(
        { roomIds: [targetRoomId, draft.roomId], userIds: [draft.teacherId, draft.studentId] },
        async (transaction) => {
            const lesson = plain(await loadLesson(lessonId, transaction));
            const student = await User.findByPk(lesson.studentId, { transaction });
            const mode = makeupBookingMode(actor, student, lesson);
            const { cycle, cycleLessons } = await loadCycleWithLessons(lesson.cycleId, transaction);
            assertOk(checkMakeupOwed(lesson, cycleLessons));

            if (mode === 'window' && !window) {
                throw new DomainError('franja_requerida', 'Elige una de las franjas de reposición disponibles.');
            }
            if (window && window.teacherId !== lesson.teacherId) {
                throw new DomainError('franja_invalida', 'Esa franja no es del profesor de la clase.');
            }
            if (!window) {
                const assigned = await TeacherRoom.findOne({ where: { teacherId: lesson.teacherId, roomId: targetRoomId }, transaction });
                if (!assigned) throw new DomainError('salon_no_asignado', 'Ese salón no está asignado al profesor.');
            }

            const settings = await getSettings({ transaction });
            const start = new Date(startsAt);
            const end = addMinutes(start, lessonMinutes(lesson));
            const range = window ? windowRange(window, start, end) : { from: start, to: end };
            const ctx = await loadScheduleContext({
                roomIds: [targetRoomId], teacherIds: [lesson.teacherId], studentIds: [lesson.studentId], ...range,
            }, { transaction, now });

            assertOk(checkMakeupTarget({ startsAt: start, endsAt: end, mode: 'reposicion', cycle, original: lesson, closures: ctx.closures, settings, now }));
            assertOk(checkTeacherPresent({ absences: ctx.absences, teacherId: lesson.teacherId, startsAt: start }));
            if (window) {
                assertOk(checkWindowSlot({ window: plain(window), startsAt: start, endsAt: end, lessons: ctx.lessons }));
            }
            assertNoConflict({
                startsAt: start, endsAt: end, roomId: targetRoomId,
                teacherId: lesson.teacherId, studentId: lesson.studentId,
            }, ctx);

            const makeup = await Lesson.create({
                cycleId: lesson.cycleId,
                period: lesson.period,
                studentId: lesson.studentId,
                teacherId: lesson.teacherId,
                roomId: targetRoomId,
                startsAt: start,
                endsAt: end,
                status: LESSON_STATUS.PROGRAMADA,
                kind: LESSON_KIND.REPOSICION,
                originalLessonId: lesson.id,
                availabilityId: window ? window.id : null,
                changedById: actor.id,
                changedAt: new Date(now),
            }, { transaction });

            await logAudit({
                entityType: 'lesson', entityId: makeup.id, action: 'crear_reposicion',
                toStatus: LESSON_STATUS.PROGRAMADA, actorId: actor.id,
                details: { originalLessonId: lesson.id, bookedBy: actor.role },
            }, { transaction });

            return { original: lesson, makeup: plain(makeup) };
        }
    );
};

/**
 * The teacher (or academy) moves an upcoming lesson to another time in the
 * same month, in one step: the original is flagged as moved and its make-up is
 * booked at the new time. Allowed until the class starts, without the student's
 * 12-hour rule (e.g. the student cannot come for reasons beyond their control).
 * It is not a cancellation.
 */
const moveLesson = async ({ lessonId, actor, roomId, startsAt, now = new Date() }) => {
    const draft = await loadLesson(lessonId);
    const targetRoomId = roomId || draft.roomId;

    return runBookingTransaction(
        { roomIds: [targetRoomId, draft.roomId], userIds: [draft.teacherId, draft.studentId] },
        async (transaction) => {
            const lessonRow = await loadLesson(lessonId, transaction);
            if (!canManageTeacherAgenda(actor, lessonRow.teacherId)) {
                throw new DomainError('sin_permiso', 'Solo puedes mover tus propias clases.', 403);
            }
            const { status } = assertOk(checkCancellation(lessonRow, actor, now));
            const lesson = plain(lessonRow);
            const assigned = await TeacherRoom.findOne({ where: { teacherId: lesson.teacherId, roomId: targetRoomId }, transaction });
            if (!assigned) throw new DomainError('salon_no_asignado', 'Ese salón no está asignado al profesor.');

            const settings = await getSettings({ transaction });
            const { cycle } = await loadCycleWithLessons(lesson.cycleId, transaction);
            const start = new Date(startsAt);
            const end = addMinutes(start, lessonMinutes(lesson));
            assertOk(checkTeacherMove({ lesson, startsAt: start, now }));
            const ctx = await loadScheduleContext({
                roomIds: [targetRoomId], teacherIds: [lesson.teacherId], studentIds: [lesson.studentId], from: start, to: end,
            }, { transaction, now });
            assertOk(checkMakeupTarget({ startsAt: start, endsAt: end, mode: 'mover', cycle, closures: ctx.closures, settings, now }));
            assertOk(checkTeacherPresent({ absences: ctx.absences, teacherId: lesson.teacherId, startsAt: start }));
            assertNoConflict({
                startsAt: start, endsAt: end, roomId: targetRoomId,
                teacherId: lesson.teacherId, studentId: lesson.studentId, ignoreLessonIds: [lesson.id],
            }, ctx);

            const changedAt = new Date(now);
            // moved: it is not a cancellation, the new lesson replaces it
            await lessonRow.update({ status, moved: true, reason: 'Movida a otro horario', changedById: actor.id, changedAt }, { transaction });
            const makeup = await Lesson.create({
                cycleId: lesson.cycleId,
                period: lesson.period,
                studentId: lesson.studentId,
                teacherId: lesson.teacherId,
                roomId: targetRoomId,
                startsAt: start,
                endsAt: end,
                status: LESSON_STATUS.PROGRAMADA,
                kind: LESSON_KIND.REPOSICION,
                originalLessonId: lesson.id,
                changedById: actor.id,
                changedAt,
            }, { transaction });
            await logAudit({
                entityType: 'lesson', entityId: lesson.id, action: 'mover',
                fromStatus: LESSON_STATUS.PROGRAMADA, toStatus: status, actorId: actor.id, details: { makeupId: makeup.id },
            }, { transaction });
            return { original: lesson, makeup: plain(makeup) };
        }
    );
};

/**
 * Teacher (or academy) cancels one or more upcoming lessons. All or nothing.
 * They become cancelada_por_profesor / cancelada_por_academia with a make-up owed.
 */
const cancelLessons = async ({ lessonIds, actor, reason = null, now = new Date() }) => {
    if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
        throw new DomainError('sin_clases', 'Elige al menos una clase para cancelar.');
    }
    return sequelize.transaction(async (transaction) => {
        const lessons = await Lesson.findAll({ where: { id: { [Op.in]: lessonIds } }, transaction });
        if (lessons.length !== new Set(lessonIds).size) {
            throw new DomainError('clase_no_encontrada', 'Alguna de las clases no existe.', 404);
        }
        const cancelled = [];
        for (const lesson of lessons) {
            if (!canManageTeacherAgenda(actor, lesson.teacherId)) {
                throw new DomainError('sin_permiso', 'Solo puedes cancelar tus propias clases.', 403);
            }
            const { status } = assertOk(checkCancellation(lesson, actor, now));
            const from = lesson.status;
            await lesson.update({ status, reason, changedById: actor.id, changedAt: new Date(now) }, { transaction });
            await logAudit({
                entityType: 'lesson', entityId: lesson.id, action: 'cancelar',
                fromStatus: from, toStatus: status, actorId: actor.id, details: reason ? { reason } : null,
            }, { transaction });
            cancelled.push(plain(lesson));
        }
        return cancelled;
    });
};

/** Teacher (or their substitute) marks attendance: tomada or perdida (perdida counts as taken). */
const markAttendance = async ({ lessonId, actor, status, now = new Date() }) =>
    sequelize.transaction(async (transaction) => {
        const lesson = await loadLesson(lessonId, transaction);
        const isSubstitute = !!lesson.substituteTeacherId && actor?.id === lesson.substituteTeacherId;
        if (!isSubstitute && !canManageTeacherAgenda(actor, lesson.teacherId)) {
            throw new DomainError('sin_permiso', 'Solo puedes marcar la asistencia de tus clases.', 403);
        }
        assertOk(checkAttendance(lesson, status, now));
        const from = lesson.status;
        await lesson.update({ status, changedById: actor.id, changedAt: new Date(now) }, { transaction });
        await logAudit({
            entityType: 'lesson', entityId: lesson.id, action: 'asistencia',
            fromStatus: from, toStatus: status, actorId: actor.id,
        }, { transaction });
        return plain(lesson);
    });

module.exports = {
    getRescheduleOptions,
    rescheduleLesson,
    getMakeupOptions,
    bookMakeup,
    moveLesson,
    cancelLessons,
    markAttendance,
};
