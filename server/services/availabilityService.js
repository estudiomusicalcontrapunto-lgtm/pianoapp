// Teachers' weekly windows: for regular classes ('clase') and for make-ups ('reposicion').
const { Op } = require('sequelize');
const { Availability, FixedSchedule, TeacherRoom, Room, User, Lesson } = require('../models');
const { AVAILABILITY_TYPE, ROLES } = require('../domain/constants');
const { DomainError, assertOk } = require('../domain/errors');
const { canManageTeacherAgenda } = require('../domain/permissions');
const { findWeeklyConflict } = require('../domain/conflicts');
const { checkWeeklySlot } = require('../domain/schedules');
const { bookedMakeupsLeftOut } = require('../domain/makeupWindows');
const { addDays, localDate, toUtc, timeToMinutes, minutesToTime, formatInstant, WEEKDAY_NAMES } = require('../domain/time');
const { runBookingTransaction } = require('./bookingTransaction');
const { loadScheduleContext } = require('./scheduleContext');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./audit');

const LOOKAHEAD_DAYS = 120;

const plain = (row) => row.get({ plain: true });

const fixedEnd = (f) => minutesToTime(timeToMinutes(f.startTime) + f.durationMinutes);

// Fixed schedules still in force that would be left outside the teacher's class windows
const orphanedFixedSchedules = (fixedSchedules, windows) =>
    fixedSchedules.filter(f => !windows.some(w =>
        w.type === AVAILABILITY_TYPE.CLASE && w.active !== false &&
        w.roomId === f.roomId && w.weekday === f.weekday &&
        w.startTime <= f.startTime && fixedEnd(f) <= w.endTime
    ));

const currentFixedSchedules = (teacherId, today, transaction) =>
    FixedSchedule.findAll({
        where: { teacherId, [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }] },
        transaction,
    });

const assertNoOrphans = async ({ teacherId, windowsAfter, now, transaction }) => {
    const fixed = (await currentFixedSchedules(teacherId, localDate(now), transaction)).map(plain);
    const orphans = orphanedFixedSchedules(fixed, windowsAfter);
    if (orphans.length) {
        const students = await User.findAll({ where: { id: orphans.map(o => o.studentId) }, attributes: ['name'], transaction });
        throw new DomainError(
            'horarios_fijos_afuera',
            `Esa franja tiene horarios fijos de ${students.map(s => s.name).join(', ')}. Muévelos antes de cambiarla o quitarla.`,
            409
        );
    }
};

// A make-up window with students booked ahead can be removed (or changed so they
// fall outside it) only after the teacher moves or cancels those classes
const assertNoBookedMakeups = async ({ window, after = null, now, transaction }) => {
    const lessons = (await Lesson.findAll({
        where: { availabilityId: window.id, endsAt: { [Op.gt]: new Date(now) } },
        include: [{ model: User, as: 'student', attributes: ['name'] }],
        transaction,
    })).map(plain);
    const leftOut = bookedMakeupsLeftOut({ window: plain(window), after, lessons, now });
    if (!leftOut.length) return;
    const list = leftOut.slice(0, 5).map(l => `${l.student?.name || 'un estudiante'} el ${formatInstant(l.startsAt)}`).join('; ');
    const more = leftOut.length > 5 ? ` y ${leftOut.length - 5} más` : '';
    const what = after ? 'cambiarla así' : 'quitarla';
    throw new DomainError(
        'reposiciones_agendadas',
        `Esta franja tiene reposiciones agendadas: ${list}${more}. Para ${what}, primero mueve o cancela esas clases en Mi agenda.`,
        409
    );
};

const validateData = (data, settings) => {
    // Classes are placed directly on the calendar; windows exist only for make-ups
    if ((data.type || AVAILABILITY_TYPE.REPOSICION) !== AVAILABILITY_TYPE.REPOSICION) {
        throw new DomainError('tipo_invalido', 'Las clases se agendan directamente; las franjas son solo para reposiciones.');
    }
    data = { ...data, type: AVAILABILITY_TYPE.REPOSICION };
    const capacity = Number(data.capacity ?? 1);
    if (!Number.isInteger(capacity) || capacity < 1) throw new DomainError('cupo_invalido', 'El cupo debe ser 1 o más.');
    assertOk(checkWeeklySlot({ weekday: Number(data.weekday), startTime: data.startTime, endTime: data.endTime, settings }));
    return { ...data, weekday: Number(data.weekday), capacity };
};

/**
 * Creates or updates a window. data: { teacherId, roomId, weekday, startTime, endTime, type, capacity }
 */
const saveAvailability = async ({ id, data, actor, now = new Date() }) => {
    const existing = id ? await Availability.findByPk(id) : null;
    if (id && !existing) throw new DomainError('franja_no_encontrada', 'Franja no encontrada.', 404);
    const teacherId = existing ? existing.teacherId : (actor.role === ROLES.TEACHER ? actor.id : data.teacherId);
    if (!canManageTeacherAgenda(actor, teacherId)) throw new DomainError('sin_permiso', 'Solo puedes editar tu propia agenda.', 403);

    const merged = { ...(existing ? plain(existing) : {}), ...data, teacherId };
    return runBookingTransaction({ roomIds: [merged.roomId, existing?.roomId], userIds: [teacherId] }, async (transaction) => {
        const settings = await getSettings({ transaction });
        const values = validateData(merged, settings);

        const [room, assigned] = await Promise.all([
            Room.findByPk(values.roomId, { transaction }),
            TeacherRoom.findOne({ where: { teacherId, roomId: values.roomId }, transaction }),
        ]);
        if (!room || !room.active) throw new DomainError('salon_invalido', 'El salón no existe o está inactivo.');
        if (!assigned) throw new DomainError('salon_no_asignado', `${room.name} no está asignado a este profesor.`);

        const ctx = await loadScheduleContext({
            roomIds: [values.roomId], teacherIds: [teacherId],
            from: new Date(now), to: toUtc(addDays(localDate(now), LOOKAHEAD_DAYS)),
        }, { transaction, now });
        const conflict = findWeeklyConflict({
            kind: 'availability', id, weekday: values.weekday, startTime: values.startTime, endTime: values.endTime,
            roomId: values.roomId, teacherId,
        }, ctx);
        if (conflict) throw new DomainError(`choque_${conflict.type}`, conflict.message, 409, conflict);

        if (existing && existing.type === AVAILABILITY_TYPE.CLASE) {
            const windows = (await Availability.findAll({ where: { teacherId, active: true }, transaction })).map(plain);
            const windowsAfter = windows.map(w => (w.id === existing.id ? { ...w, ...values } : w));
            await assertNoOrphans({ teacherId, windowsAfter, now, transaction });
        }
        if (existing && existing.type === AVAILABILITY_TYPE.REPOSICION) {
            await assertNoBookedMakeups({ window: existing, after: values, now, transaction });
        }

        const fields = {
            teacherId, roomId: values.roomId, weekday: values.weekday, startTime: values.startTime,
            endTime: values.endTime, type: values.type, capacity: values.capacity,
        };
        const window = existing
            ? await existing.update(fields, { transaction })
            : await Availability.create(fields, { transaction });
        await logAudit({
            entityType: 'availability', entityId: window.id, action: existing ? 'editar' : 'crear', actorId: actor.id,
            details: { ...fields, dia: WEEKDAY_NAMES[fields.weekday] },
        }, { transaction });
        return plain(window);
    });
};

// Windows are deactivated, not deleted: booked make-ups keep pointing to them
const removeAvailability = async ({ id, actor, now = new Date() }) => {
    const existing = await Availability.findByPk(id);
    if (!existing || !existing.active) throw new DomainError('franja_no_encontrada', 'Franja no encontrada.', 404);
    if (!canManageTeacherAgenda(actor, existing.teacherId)) throw new DomainError('sin_permiso', 'Solo puedes editar tu propia agenda.', 403);

    return runBookingTransaction({ roomIds: [existing.roomId], userIds: [existing.teacherId] }, async (transaction) => {
        if (existing.type === AVAILABILITY_TYPE.CLASE) {
            const windows = (await Availability.findAll({ where: { teacherId: existing.teacherId, active: true }, transaction })).map(plain);
            await assertNoOrphans({
                teacherId: existing.teacherId, windowsAfter: windows.filter(w => w.id !== existing.id), now, transaction,
            });
        }
        if (existing.type === AVAILABILITY_TYPE.REPOSICION) {
            await assertNoBookedMakeups({ window: existing, now, transaction });
        }
        await existing.update({ active: false }, { transaction });
        await logAudit({ entityType: 'availability', entityId: id, action: 'quitar', actorId: actor.id }, { transaction });
        return plain(existing);
    });
};

module.exports = { saveAvailability, removeAvailability, orphanedFixedSchedules };
