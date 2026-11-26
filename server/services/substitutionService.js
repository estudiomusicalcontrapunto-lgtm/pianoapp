// Teacher absences and substitutes ("reemplazos"). The academy records the days
// a teacher is away, then gives the lessons in that range to another teacher of
// the academy or to an outside one, or cancels them (a make-up is owed).
// The lesson keeps its teacher: the student stays theirs.
const { Op } = require('sequelize');
const { sequelize, Lesson, TeacherAbsence, User, Room } = require('../models');
const { ROLES, LESSON_STATUS } = require('../domain/constants');
const { DomainError, assertOk } = require('../domain/errors');
const { findDatedConflict } = require('../domain/conflicts');
const {
    absenceOn, checkAbsenceDates, overlappingAbsence, normalizeSubstitute, checkSubstitutable, hasSubstitute,
} = require('../domain/absences');
const { localDate, localParts, addDays, toUtc, formatInstant, formatDay } = require('../domain/time');
const { loadScheduleContext } = require('./scheduleContext');
const { createNotice } = require('./noticeService');
const { logAudit } = require('./audit');

const plain = (row) => row.get({ plain: true });

// UTC bounds of an absence's local days
const rangeOf = (absence) => ({ from: toUtc(absence.startDate), to: toUtc(addDays(absence.endDate, 1)) });

const substituteLabel = (lesson, nameOf) =>
    (lesson.substituteTeacherId ? nameOf[lesson.substituteTeacherId] || 'Otro profesor' : lesson.substituteName) || null;

const loadAbsence = async (id) => {
    const absence = await TeacherAbsence.findByPk(id);
    if (!absence) throw new DomainError('ausencia_no_encontrada', 'Ausencia no encontrada.', 404);
    return absence;
};

const lessonsInAbsence = (absence, extraWhere = {}) => {
    const { from, to } = rangeOf(absence);
    return Lesson.findAll({
        where: { teacherId: absence.teacherId, startsAt: { [Op.gte]: from, [Op.lt]: to }, ...extraWhere },
        include: [
            { model: User, as: 'student', attributes: ['id', 'name', 'instrumentId', 'active'] },
            { model: Room, as: 'room', attributes: ['id', 'name'] },
        ],
        order: [['startsAt', 'ASC']],
    });
};

// How many lessons of the absence are covered, still uncovered or cancelled
const summarize = (lessons, now) => {
    const upcoming = lessons.filter(l => l.status === LESSON_STATUS.PROGRAMADA && new Date(l.startsAt) > new Date(now));
    return {
        total: lessons.length,
        covered: lessons.filter(l => hasSubstitute(l) && l.status !== LESSON_STATUS.CANCELADA_POR_ACADEMIA).length,
        uncovered: upcoming.filter(l => !hasSubstitute(l)).length,
        cancelled: lessons.filter(l => [LESSON_STATUS.CANCELADA_POR_ACADEMIA, LESSON_STATUS.CANCELADA_POR_PROFESOR].includes(l.status) && !l.moved).length,
    };
};

/** Absences that have not ended (or all with includePast), newest first, each with its lesson summary. */
const listAbsences = async ({ includePast = false, now = new Date() } = {}) => {
    const today = localDate(now);
    const absences = await TeacherAbsence.findAll({
        where: includePast ? {} : { endDate: { [Op.gte]: today } },
        include: [{ model: User, as: 'teacher', attributes: ['id', 'name'] }],
        order: [['startDate', 'ASC']],
    });
    return Promise.all(absences.map(async (absence) => {
        const lessons = (await lessonsInAbsence(absence)).filter(l => l.student?.active !== false);
        const { teacher, ...data } = plain(absence);
        return { ...data, teacherName: teacher?.name, summary: summarize(lessons, now) };
    }));
};

const createAbsence = async ({ teacherId, startDate, endDate, reason, actor, now = new Date() }) => {
    const teacher = await User.findOne({ where: { id: teacherId || null, role: ROLES.TEACHER, active: true } });
    if (!teacher) throw new DomainError('profesor_invalido', 'Elige el profesor que se ausenta.');
    assertOk(checkAbsenceDates({ startDate, endDate, today: localDate(now) }));
    const others = await TeacherAbsence.findAll({ where: { teacherId } });
    const clash = overlappingAbsence(others.map(plain), { teacherId, startDate, endDate });
    if (clash) {
        throw new DomainError('ausencia_repetida', `${teacher.name} ya tiene una ausencia del ${formatDay(clash.startDate)} al ${formatDay(clash.endDate)}.`, 409);
    }
    const absence = await TeacherAbsence.create({
        teacherId, startDate, endDate, reason: String(reason || '').trim().slice(0, 200) || null, createdById: actor.id,
    });
    await logAudit({ entityType: 'teacher_absence', entityId: absence.id, action: 'crear', actorId: actor.id, details: { teacherId, startDate, endDate } });
    return absence;
};

/**
 * The lessons of an absence, each with its substitute and the academy teachers
 * who could take it: { absence, lessons: [{ ..., substitute, candidates: [{ id, name, free, reason }] }] }.
 * Teachers who teach the student's instrument come first.
 */
const getAbsenceDetail = async ({ id, now = new Date() }) => {
    const absence = await loadAbsence(id);
    const lessons = (await lessonsInAbsence(absence)).filter(l => l.student?.active !== false);
    const absentTeacher = await User.findByPk(absence.teacherId, { attributes: ['id', 'name', 'cityId'] });
    // Only teachers of the same city can cover: the classes are in that city's rooms
    const teachers = await User.findAll({
        where: {
            role: ROLES.TEACHER, active: true, id: { [Op.ne]: absence.teacherId },
            ...(absentTeacher?.cityId ? { cityId: absentTeacher.cityId } : {}),
        },
        include: ['instruments'],
        order: [['name', 'ASC']],
    });
    const nameOf = Object.fromEntries([...teachers, absentTeacher].map(t => [t.id, t.name]));

    const { from, to } = rangeOf(absence);
    const ctx = await loadScheduleContext({ teacherIds: teachers.map(t => t.id), from, to }, { now });

    const upcoming = (lesson) => lesson.status === LESSON_STATUS.PROGRAMADA && new Date(lesson.startsAt) > new Date(now);
    const candidatesFor = (lesson) => teachers
        .map(t => {
            const away = absenceOn(ctx.absences, t.id, localParts(lesson.startsAt).date);
            const conflict = away ? null : findDatedConflict({
                startsAt: lesson.startsAt, endsAt: lesson.endsAt, teacherId: t.id, ignoreLessonIds: [lesson.id],
            }, ctx);
            const teachesInstrument = !lesson.student?.instrumentId || t.instruments.some(i => i.id === lesson.student.instrumentId);
            return {
                id: t.id,
                name: t.name,
                teachesInstrument,
                free: !away && !conflict,
                reason: away ? 'Ausente ese día' : conflict ? 'Tiene otra clase a esa hora' : null,
            };
        })
        .sort((a, b) => (b.teachesInstrument - a.teachesInstrument) || (b.free - a.free) || a.name.localeCompare(b.name));

    return {
        absence: { ...plain(absence), teacherName: absentTeacher?.name },
        summary: summarize(lessons, now),
        lessons: lessons.map(lesson => {
            const { student, room, ...data } = plain(lesson);
            return {
                ...data,
                studentName: student?.name,
                roomName: room?.name,
                substitute: substituteLabel(lesson, nameOf),
                editable: upcoming(lesson),
                candidates: upcoming(lesson) ? candidatesFor(lesson) : [],
            };
        }),
    };
};

/**
 * Gives lessons to a substitute, all or nothing. An academy teacher must be
 * free and present at each lesson's time (also counting the other lessons
 * given to them in this same call).
 * substitute: { teacherId } or { name, phone? }.
 */
const assignSubstitute = async ({ lessonIds, substitute, actor, now = new Date() }) => {
    if (!Array.isArray(lessonIds) || lessonIds.length === 0) throw new DomainError('sin_clases', 'Elige al menos una clase.');
    const { fields } = assertOk(normalizeSubstitute(substitute));

    return sequelize.transaction(async (transaction) => {
        const lessons = await Lesson.findAll({ where: { id: lessonIds }, order: [['startsAt', 'ASC']], transaction });
        if (lessons.length !== new Set(lessonIds).size) throw new DomainError('clase_no_encontrada', 'Alguna de las clases no existe.', 404);
        lessons.forEach(l => assertOk(checkSubstitutable(l, now)));

        let substituteUser = null;
        if (fields.substituteTeacherId) {
            substituteUser = await User.findOne({ where: { id: fields.substituteTeacherId, role: ROLES.TEACHER, active: true }, transaction });
            if (!substituteUser) throw new DomainError('profesor_invalido', 'Ese profesor no existe.');
            if (lessons.some(l => l.teacherId === substituteUser.id)) {
                throw new DomainError('reemplazo_invalido', 'Un profesor no puede reemplazarse a sí mismo.');
            }
            const owners = await User.findAll({ where: { id: [...new Set(lessons.map(l => l.teacherId))] }, attributes: ['cityId'], transaction });
            if (owners.some(o => o.cityId && substituteUser.cityId && o.cityId !== substituteUser.cityId)) {
                throw new DomainError('ciudad_distinta', `${substituteUser.name} enseña en otra ciudad. Elige un profesor de la misma ciudad.`);
            }
            const ctx = await loadScheduleContext({
                teacherIds: [substituteUser.id],
                from: lessons[0].startsAt,
                to: lessons[lessons.length - 1].endsAt,
            }, { transaction, now });
            for (const lesson of lessons) {
                if (absenceOn(ctx.absences, substituteUser.id, localParts(lesson.startsAt).date)) {
                    throw new DomainError('reemplazo_ausente', `${substituteUser.name} también está ausente el ${formatDay(localParts(lesson.startsAt).date)}.`, 409);
                }
                const conflict = findDatedConflict({
                    startsAt: lesson.startsAt, endsAt: lesson.endsAt, teacherId: substituteUser.id, ignoreLessonIds: [lesson.id],
                }, ctx);
                if (conflict) {
                    throw new DomainError('choque_profesor', `${substituteUser.name} no puede el ${formatInstant(lesson.startsAt)}: ${conflict.message}`, 409, conflict);
                }
                // The next lessons of this call see this one as taken
                ctx.lessons.push({ ...plain(lesson), ...fields });
            }
        }

        for (const lesson of lessons) {
            await lesson.update({ ...fields, changedById: actor.id, changedAt: new Date(now) }, { transaction });
            await logAudit({
                entityType: 'lesson', entityId: lesson.id, action: 'asignar_reemplazo', actorId: actor.id,
                details: { substituteTeacherId: fields.substituteTeacherId, substituteName: fields.substituteName },
            }, { transaction });
        }
        return { lessons: lessons.map(plain), substituteName: substituteUser?.name || fields.substituteName };
    });
};

/** The lessons go back to their own teacher. */
const removeSubstitute = async ({ lessonIds, actor, now = new Date() }) =>
    sequelize.transaction(async (transaction) => {
        const lessons = await Lesson.findAll({ where: { id: lessonIds || [] }, transaction });
        const released = [];
        for (const lesson of lessons.filter(hasSubstitute)) {
            assertOk(checkSubstitutable(lesson, now));
            const before = { substituteTeacherId: lesson.substituteTeacherId, substituteName: lesson.substituteName };
            await lesson.update({ substituteTeacherId: null, substituteName: null, substitutePhone: null, changedById: actor.id, changedAt: new Date(now) }, { transaction });
            await logAudit({ entityType: 'lesson', entityId: lesson.id, action: 'quitar_reemplazo', actorId: actor.id, details: before }, { transaction });
            released.push({ ...plain(lesson), previousSubstituteId: before.substituteTeacherId });
        }
        return released;
    });

/** The upcoming lessons of the absence that still have no substitute. */
const uncoveredLessonIds = async ({ id, now = new Date() }) => {
    const absence = await loadAbsence(id);
    const lessons = await lessonsInAbsence(absence, { status: LESSON_STATUS.PROGRAMADA });
    return {
        absence,
        lessonIds: lessons
            .filter(l => new Date(l.startsAt) > new Date(now) && !hasSubstitute(l) && l.student?.active !== false)
            .map(l => l.id),
    };
};

/**
 * Deletes an absence. Its upcoming lessons go back to their teacher;
 * returns them so the caller can tell the students.
 */
const deleteAbsence = async ({ id, actor, now = new Date() }) => {
    const absence = await loadAbsence(id);
    const covered = (await lessonsInAbsence(absence)).filter(l => hasSubstitute(l) && checkSubstitutable(l, now).ok);
    const released = covered.length ? await removeSubstitute({ lessonIds: covered.map(l => l.id), actor, now }) : [];
    await absence.destroy();
    await logAudit({ entityType: 'teacher_absence', entityId: id, action: 'borrar', actorId: actor.id, details: { released: released.length } });
    return { released };
};

// --- Notices ---

const notifyAssigned = async ({ lessons, substituteName, substituteTeacherId, actor }) => {
    const teacherIds = [...new Set(lessons.map(l => l.teacherId))];
    const teachers = await User.findAll({ where: { id: teacherIds }, attributes: ['id', 'name'] });
    const teacherName = Object.fromEntries(teachers.map(t => [t.id, t.name]));
    for (const lesson of lessons) {
        await createNotice({
            category: 'reemplazo',
            title: 'Clase con reemplazo',
            message: `Tu clase del ${formatInstant(lesson.startsAt)} la dictará ${substituteName}, porque ${teacherName[lesson.teacherId]} no podrá darla. Sigue siendo tu profesor.`,
            recipientIds: [lesson.studentId],
            authorId: actor.id,
            meta: { lessonId: lesson.id },
        });
    }
    if (substituteTeacherId) {
        const list = lessons.map(l => formatInstant(l.startsAt)).join('; ');
        await createNotice({
            category: 'reemplazo_asignado',
            title: lessons.length === 1 ? 'Te asignaron un reemplazo' : `Te asignaron ${lessons.length} reemplazos`,
            message: `Darás ${lessons.length === 1 ? 'la clase' : 'las clases'} de ${teachers.map(t => t.name).join(', ')}: ${list}. Las ves en tu Resumen.`,
            recipientIds: [substituteTeacherId],
            authorId: actor.id,
        });
    }
};

const notifyReleased = async ({ lessons, actor }) => {
    for (const lesson of lessons) {
        await createNotice({
            category: 'reemplazo_quitado',
            title: 'Vuelve tu profesor',
            message: `Tu clase del ${formatInstant(lesson.startsAt)} ya no tiene reemplazo: la dará tu profesor.`,
            recipientIds: [lesson.studentId],
            authorId: actor.id,
            meta: { lessonId: lesson.id },
        });
    }
    const bySubstitute = {};
    for (const lesson of lessons.filter(l => l.previousSubstituteId)) {
        (bySubstitute[lesson.previousSubstituteId] ||= []).push(formatInstant(lesson.startsAt));
    }
    for (const [substituteId, times] of Object.entries(bySubstitute)) {
        await createNotice({
            category: 'reemplazo_quitado',
            title: 'Reemplazo cancelado',
            message: `Ya no darás estas clases: ${times.join('; ')}.`,
            recipientIds: [substituteId],
            authorId: actor.id,
        });
    }
};

// --- Report ---

/**
 * One month ('YYYY-MM') of substitutions and teacher moves:
 * { given: [{ substitute, external, phone, lessons: [...] }], moves: [{ teacherName, count, lessons: [...] }] }.
 * Substitutions count lessons taken or missed by the student (both are paid); moves count moved lessons by their original date.
 */
const buildReport = async ({ month }) => {
    const [y, m] = month.split('-').map(Number);
    const from = toUtc(`${month}-01`);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const to = toUtc(nextMonth);
    const include = [
        { model: User, as: 'student', attributes: ['id', 'name'] },
        { model: User, as: 'teacher', attributes: ['id', 'name'] },
        { model: User, as: 'substitute', attributes: ['id', 'name'] },
    ];
    const window = { startsAt: { [Op.gte]: from, [Op.lt]: to } };

    const substituted = await Lesson.findAll({
        where: {
            ...window,
            status: [LESSON_STATUS.TOMADA, LESSON_STATUS.PERDIDA, LESSON_STATUS.PROGRAMADA],
            [Op.or]: [{ substituteTeacherId: { [Op.ne]: null } }, { substituteName: { [Op.ne]: null } }],
        },
        include,
        order: [['startsAt', 'ASC']],
    });
    const given = {};
    for (const lesson of substituted) {
        const key = lesson.substituteTeacherId || `externo:${lesson.substituteName.toLowerCase()}`;
        given[key] ||= {
            substitute: lesson.substitute?.name || lesson.substituteName,
            external: !lesson.substituteTeacherId,
            phone: lesson.substitutePhone,
            done: 0,
            upcoming: 0,
            lessons: [],
        };
        if (lesson.status === LESSON_STATUS.PROGRAMADA) given[key].upcoming += 1;
        else given[key].done += 1;
        given[key].lessons.push({
            id: lesson.id, startsAt: lesson.startsAt, status: lesson.status, studentName: lesson.student?.name, teacherName: lesson.teacher?.name,
        });
    }

    const moved = await Lesson.findAll({ where: { ...window, moved: true }, include, order: [['startsAt', 'ASC']] });
    const makeups = await Lesson.findAll({ where: { originalLessonId: moved.map(l => l.id) }, attributes: ['id', 'originalLessonId', 'startsAt'] });
    const movedTo = Object.fromEntries(makeups.map(mk => [mk.originalLessonId, mk.startsAt]));
    // How many times the chain was moved before this lesson: a lesson moved twice shows "2.ª vez"
    const allMoved = await Lesson.findAll({ where: { moved: true }, attributes: ['id', 'originalLessonId'] });
    const movedById = Object.fromEntries(allMoved.map(l => [l.id, l]));
    const timesMoved = (lesson) => {
        let count = 1;
        for (let parent = movedById[lesson.originalLessonId]; parent; parent = movedById[parent.originalLessonId]) count += 1;
        return count;
    };
    const moves = {};
    for (const lesson of moved) {
        const key = lesson.teacherId;
        moves[key] ||= { teacherName: lesson.teacher?.name, count: 0, lessons: [] };
        moves[key].count += 1;
        moves[key].lessons.push({
            id: lesson.id, from: lesson.startsAt, to: movedTo[lesson.id] || null, studentName: lesson.student?.name, time: timesMoved(lesson),
        });
    }

    return {
        month,
        given: Object.values(given).sort((a, b) => b.done - a.done),
        moves: Object.values(moves).sort((a, b) => b.count - a.count),
    };
};

module.exports = {
    listAbsences,
    createAbsence,
    getAbsenceDetail,
    assignSubstitute,
    removeSubstitute,
    uncoveredLessonIds,
    deleteAbsence,
    notifyAssigned,
    notifyReleased,
    buildReport,
};
