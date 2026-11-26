// The instrument catalog, the instruments each teacher teaches and the checks
// that keep a student's teacher in line with the student's instrument.
const { Op } = require('sequelize');
const { sequelize, Instrument, InstrumentLevel, TeacherInstrument, User } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { logAudit } = require('./audit');

/** Instruments with their ladder: [{ id, name, active, levels: ['Inicial', '1', ...] }] */
const listInstruments = async ({ includeInactive = false } = {}) => {
    const instruments = await Instrument.findAll({
        where: includeInactive ? {} : { active: true },
        include: [{ model: InstrumentLevel, as: 'levels', attributes: ['name', 'position'] }],
        order: [['name', 'ASC']],
    });
    return instruments.map(i => ({
        ...i.get({ plain: true }),
        levels: [...i.levels].sort((a, b) => a.position - b.position).map(l => l.name),
    }));
};

const assertUniqueName = async (name, excludeId) => {
    const clean = String(name || '').trim();
    if (!clean) throw new DomainError('nombre_requerido', 'El nombre del instrumento es obligatorio.');
    const same = (await Instrument.findAll()).find(i => i.name.toLowerCase() === clean.toLowerCase() && i.id !== excludeId);
    if (same) throw new DomainError('instrumento_repetido', `Ya existe el instrumento "${same.name}".`);
    return clean;
};

const createInstrument = async ({ name, actor }) => {
    const instrument = await Instrument.create({ name: await assertUniqueName(name) });
    await logAudit({ entityType: 'instrument', entityId: instrument.id, action: 'crear', actorId: actor.id });
    return instrument;
};

// Renames or (de)activates. An instrument in use can be deactivated: its students keep it.
const updateInstrument = async ({ id, name, active, actor }) => {
    const instrument = await Instrument.findByPk(id);
    if (!instrument) throw new DomainError('instrumento_no_encontrado', 'Instrumento no encontrado.', 404);
    const changes = {};
    if (name !== undefined) changes.name = await assertUniqueName(name, id);
    if (active !== undefined) changes.active = !!active;
    await instrument.update(changes);
    await logAudit({ entityType: 'instrument', entityId: id, action: 'editar', actorId: actor.id, details: changes });
    return instrument;
};

const assertActiveInstrument = async (instrumentId, { transaction } = {}) => {
    const instrument = await Instrument.findByPk(instrumentId, { transaction });
    if (!instrument || !instrument.active) throw new DomainError('instrumento_invalido', 'El instrumento no existe o está inactivo.');
    return instrument;
};

const teacherInstrumentIds = async (teacherId, { transaction } = {}) =>
    (await TeacherInstrument.findAll({ where: { teacherId }, transaction })).map(r => r.instrumentId);

// Replaces the instruments a teacher teaches
const setTeacherInstruments = async ({ teacherId, instrumentIds, actor }) => {
    const ids = [...new Set(instrumentIds || [])];
    return sequelize.transaction(async (transaction) => {
        const teacher = await User.findOne({ where: { id: teacherId, role: ROLES.TEACHER }, transaction });
        if (!teacher) throw new DomainError('profesor_invalido', 'El profesor no existe.', 404);
        const instruments = await Instrument.findAll({ where: { id: { [Op.in]: ids } }, transaction });
        if (instruments.length !== ids.length) throw new DomainError('instrumento_invalido', 'Algún instrumento no existe.');

        const before = await teacherInstrumentIds(teacherId, { transaction });
        const removed = before.filter(id => !ids.includes(id));
        if (removed.length) {
            const orphans = await User.count({
                where: { role: ROLES.STUDENT, active: true, teacherId, instrumentId: { [Op.in]: removed } }, transaction,
            });
            if (orphans) {
                throw new DomainError(
                    'instrumento_en_uso',
                    `${teacher.name} tiene ${orphans} estudiante(s) de un instrumento que quieres quitarle. Reasígnalos primero.`,
                    409
                );
            }
        }
        await TeacherInstrument.destroy({ where: { teacherId }, transaction });
        await TeacherInstrument.bulkCreate(ids.map(instrumentId => ({ teacherId, instrumentId })), { transaction });
        await logAudit({
            entityType: 'user', entityId: teacherId, action: 'asignar_instrumentos', actorId: actor.id, details: { instrumentIds: ids },
        }, { transaction });
        return instruments;
    });
};

/**
 * A student's teacher must teach the student's instrument. A teacher with no
 * instruments set yet is not checked, so older accounts keep working.
 */
const assertTeacherTeaches = async ({ teacherId, instrumentId }, { transaction } = {}) => {
    if (!teacherId || !instrumentId) return;
    const ids = await teacherInstrumentIds(teacherId, { transaction });
    if (ids.length && !ids.includes(instrumentId)) {
        const [teacher, instrument] = await Promise.all([
            User.findByPk(teacherId, { attributes: ['name'], transaction }),
            Instrument.findByPk(instrumentId, { attributes: ['name'], transaction }),
        ]);
        throw new DomainError('profesor_sin_instrumento', `${teacher?.name || 'Ese profesor'} no enseña ${instrument?.name || 'ese instrumento'}.`);
    }
};

// Instrument for a new student when none is given: the teacher's only one, else the academy's only one
const defaultInstrumentId = async (teacherId, { transaction } = {}) => {
    if (teacherId) {
        const ids = await teacherInstrumentIds(teacherId, { transaction });
        if (ids.length === 1) return ids[0];
    }
    const active = await Instrument.findAll({ where: { active: true }, transaction });
    return active.length === 1 ? active[0].id : null;
};

module.exports = {
    listInstruments,
    createInstrument,
    updateInstrument,
    assertActiveInstrument,
    teacherInstrumentIds,
    setTeacherInstruments,
    assertTeacherTeaches,
    defaultInstrumentId,
};
