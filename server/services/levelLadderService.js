// The ladder of levels of each instrument: the academy adds, renames, orders and
// removes levels in "Grados". Students, requirements and level-up requests refer
// to a level by name, so a rename is carried to all of them.
const { Op } = require('sequelize');
const { sequelize, Instrument, InstrumentLevel, User, LevelRequirement, LevelResource, LevelRequest } = require('../models');
const { ROLES, LEVEL_REQUEST_STATUS } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { STANDARD_LEVELS, levelLabel, normalizeLevelName } = require('../domain/levels');
const { logAudit } = require('./audit');

const OPEN_REQUESTS = [LEVEL_REQUEST_STATUS.PENDIENTE, LEVEL_REQUEST_STATUS.MUESTRA_PROGRAMADA];

const loadLevels = (instrumentId, transaction) =>
    InstrumentLevel.findAll({ where: { instrumentId }, order: [['position', 'ASC']], transaction });

/** Level names of an instrument, lowest first. No instrument: the standard ladder. */
const getLadder = async (instrumentId, { transaction } = {}) => {
    if (!instrumentId) return STANDARD_LEVELS;
    return (await loadLevels(instrumentId, transaction)).map(l => l.name);
};

const assertInstrument = async (instrumentId, transaction) => {
    const instrument = await Instrument.findByPk(instrumentId, { transaction });
    if (!instrument) throw new DomainError('instrumento_no_encontrado', 'Instrumento no encontrado.', 404);
    return instrument;
};

const cleanName = (name) => {
    const checked = normalizeLevelName(name);
    if (!checked.ok) throw new DomainError(checked.code, checked.message);
    return checked.name;
};

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// Students of the instrument (archived too: their level must stay on the ladder)
const studentIdsOf = async (instrumentId, transaction) =>
    (await User.findAll({ where: { role: ROLES.STUDENT, instrumentId }, attributes: ['id'], transaction })).map(u => u.id);

/** Adds a level at position (0 = lowest; default: the top). */
const addLevel = async ({ instrumentId, name, position, actor }) => sequelize.transaction(async (transaction) => {
    await assertInstrument(instrumentId, transaction);
    const clean = cleanName(name);
    const levels = await loadLevels(instrumentId, transaction);
    if (levels.some(l => sameName(l.name, clean))) throw new DomainError('nivel_repetido', `Ya existe el nivel "${clean}".`, 409);

    const at = Number.isInteger(position) ? Math.max(0, Math.min(position, levels.length)) : levels.length;
    for (const level of levels.filter(l => l.position >= at).reverse()) {
        await level.update({ position: level.position + 1 }, { transaction });
    }
    await InstrumentLevel.create({ instrumentId, name: clean, position: at }, { transaction });
    await logAudit({ entityType: 'instrument', entityId: instrumentId, action: 'agregar_nivel', actorId: actor.id, details: { name: clean, position: at } }, { transaction });
    return getLadder(instrumentId, { transaction });
});

/** Renames a level here and wherever it is used. */
const renameLevel = async ({ instrumentId, from, to, actor }) => sequelize.transaction(async (transaction) => {
    await assertInstrument(instrumentId, transaction);
    const clean = cleanName(to);
    const levels = await loadLevels(instrumentId, transaction);
    const level = levels.find(l => l.name === from);
    if (!level) throw new DomainError('nivel_no_encontrado', 'Ese nivel no existe.', 404);
    if (levels.some(l => l !== level && sameName(l.name, clean))) throw new DomainError('nivel_repetido', `Ya existe el nivel "${clean}".`, 409);
    if (clean === from) return getLadder(instrumentId, { transaction });

    const studentIds = await studentIdsOf(instrumentId, transaction);
    await level.update({ name: clean }, { transaction });
    await User.update({ level: clean }, { where: { id: studentIds, level: from }, transaction });
    await LevelRequirement.update({ level: clean }, { where: { instrumentId, level: from }, transaction });
    await LevelResource.update({ level: clean }, { where: { instrumentId, level: from }, transaction });
    await LevelRequest.update({ fromLevel: clean }, { where: { studentId: studentIds, fromLevel: from }, transaction });
    await LevelRequest.update({ toLevel: clean }, { where: { studentId: studentIds, toLevel: from }, transaction });
    await logAudit({ entityType: 'instrument', entityId: instrumentId, action: 'renombrar_nivel', actorId: actor.id, details: { from, to: clean } }, { transaction });
    return getLadder(instrumentId, { transaction });
});

/** names: every level of the instrument in the new order, lowest first. */
const reorderLevels = async ({ instrumentId, names, actor }) => sequelize.transaction(async (transaction) => {
    await assertInstrument(instrumentId, transaction);
    const levels = await loadLevels(instrumentId, transaction);
    const given = Array.isArray(names) ? names : [];
    if (given.length !== levels.length || new Set(given).size !== given.length || !given.every(n => levels.some(l => l.name === n))) {
        throw new DomainError('orden_invalido', 'El nuevo orden debe tener todos los niveles, una vez cada uno.');
    }
    for (const level of levels) {
        await level.update({ position: given.indexOf(level.name) }, { transaction });
    }
    await logAudit({ entityType: 'instrument', entityId: instrumentId, action: 'ordenar_niveles', actorId: actor.id, details: { names: given } }, { transaction });
    return getLadder(instrumentId, { transaction });
});

/**
 * Removes a level nobody is on, with its requirements and attachments.
 * Returns { ladder, files } so the caller deletes the attached PDFs.
 */
const deleteLevel = async ({ instrumentId, name, actor }) => sequelize.transaction(async (transaction) => {
    const instrument = await assertInstrument(instrumentId, transaction);
    const levels = await loadLevels(instrumentId, transaction);
    const level = levels.find(l => l.name === name);
    if (!level) throw new DomainError('nivel_no_encontrado', 'Ese nivel no existe.', 404);
    if (levels.length === 1) throw new DomainError('ultimo_nivel', 'Un instrumento necesita al menos un nivel.');

    const studentIds = await studentIdsOf(instrumentId, transaction);
    const onLevel = await User.count({ where: { id: studentIds, level: name }, transaction });
    if (onLevel) {
        throw new DomainError('nivel_en_uso', `${onLevel} estudiante(s) de ${instrument.name} están en ${levelLabel(name)}. Cámbialos de nivel antes de borrarlo.`, 409);
    }
    const openRequests = await LevelRequest.count({ where: { studentId: studentIds, toLevel: name, status: { [Op.in]: OPEN_REQUESTS } }, transaction });
    if (openRequests) {
        throw new DomainError('nivel_en_uso', `Hay ${openRequests} solicitud(es) de ascenso abiertas a ${levelLabel(name)}. Resuélvelas antes de borrarlo.`, 409);
    }

    const resources = await LevelResource.findAll({ where: { instrumentId, level: name }, transaction });
    await LevelResource.destroy({ where: { instrumentId, level: name }, transaction });
    await LevelRequirement.destroy({ where: { instrumentId, level: name }, transaction });
    await level.destroy({ transaction });
    for (const other of levels.filter(l => l.position > level.position)) {
        await other.update({ position: other.position - 1 }, { transaction });
    }
    await logAudit({ entityType: 'instrument', entityId: instrumentId, action: 'borrar_nivel', actorId: actor.id, details: { name } }, { transaction });
    return { ladder: await getLadder(instrumentId, { transaction }), files: resources.map(r => r.filePath).filter(Boolean) };
});

module.exports = { getLadder, addLevel, renameLevel, reorderLevels, deleteLevel };
