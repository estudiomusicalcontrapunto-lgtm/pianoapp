// "Grados": what each level asks for, per instrument. The academy writes the
// requirements and attaches PDFs or links; teachers read the guides of the
// instruments they teach and students the guide of their own instrument.
const { Instrument, LevelRequirement, LevelResource } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { isHttpUrl } = require('../domain/levels');
const { teacherInstrumentIds } = require('./instrumentService');
const { getLadder } = require('./levelLadderService');
const { logAudit } = require('./audit');

const MAX_TITLE = 200;

const canViewGuide = async (actor, instrumentId) => {
    if (actor.role === ROLES.ACADEMY) return true;
    if (actor.role === ROLES.TEACHER) return (await teacherInstrumentIds(actor.id)).includes(instrumentId);
    return actor.role === ROLES.STUDENT && actor.instrumentId === instrumentId;
};

const loadInstrument = async (instrumentId) => {
    const instrument = await Instrument.findByPk(instrumentId);
    if (!instrument) throw new DomainError('instrumento_no_encontrado', 'Instrumento no encontrado.', 404);
    return instrument;
};

/** Checks the target of an edit: the instrument exists and the level is on its ladder. */
const assertEditable = async (instrumentId, level) => {
    const instrument = await loadInstrument(instrumentId);
    if (!(await getLadder(instrumentId)).includes(level)) {
        throw new DomainError('nivel_invalido', `Ese nivel no existe en ${instrument.name}.`);
    }
    return instrument;
};

/** Every level of the instrument, lowest first, with its requirements and attachments. */
const getGuide = async ({ instrumentId, actor }) => {
    const instrument = await loadInstrument(instrumentId);
    if (!(await canViewGuide(actor, instrumentId))) {
        throw new DomainError('sin_permiso', 'No tienes acceso a los grados de este instrumento.', 403);
    }
    const [requirements, resources, ladder] = await Promise.all([
        LevelRequirement.findAll({ where: { instrumentId } }),
        LevelResource.findAll({ where: { instrumentId }, order: [['createdAt', 'ASC']] }),
        getLadder(instrumentId),
    ]);
    return {
        instrument: { id: instrument.id, name: instrument.name, active: instrument.active },
        levels: ladder.map(level => {
            const requirement = requirements.find(r => r.level === level);
            return {
                level,
                description: requirement?.description || '',
                updatedAt: requirement?.updatedAt || null,
                resources: resources.filter(r => r.level === level).map(r => r.toJSON()),
            };
        }),
    };
};

/** Writes the requirements text of a level. An empty text removes it. */
const saveRequirement = async ({ instrumentId, level, description, actor }) => {
    await assertEditable(instrumentId, level);
    const text = String(description ?? '').trim();
    const existing = await LevelRequirement.findOne({ where: { instrumentId, level } });
    if (!text) {
        if (existing) await existing.destroy();
    } else if (existing) {
        await existing.update({ description: text, updatedById: actor.id });
    } else {
        await LevelRequirement.create({ instrumentId, level, description: text, updatedById: actor.id });
    }
    await logAudit({ entityType: 'level_requirement', entityId: `${instrumentId}:${level}`, action: text ? 'editar' : 'borrar', actorId: actor.id });
    return { level, description: text };
};

const cleanTitle = (title, fallback) => {
    const text = String(title ?? '').trim() || fallback;
    if (!text) throw new DomainError('titulo_requerido', 'Ponle un título al adjunto.');
    if (text.length > MAX_TITLE) throw new DomainError('titulo_largo', `El título no puede pasar de ${MAX_TITLE} caracteres.`);
    return text;
};

const addLink = async ({ instrumentId, level, title, url, actor }) => {
    await assertEditable(instrumentId, level);
    const cleanUrl = String(url ?? '').trim();
    if (!isHttpUrl(cleanUrl)) throw new DomainError('enlace_invalido', 'El enlace debe empezar por http:// o https://.');
    const resource = await LevelResource.create({
        instrumentId, level, kind: 'enlace', title: cleanTitle(title), url: cleanUrl, createdById: actor.id,
    });
    await logAudit({ entityType: 'level_resource', entityId: resource.id, action: 'crear', actorId: actor.id, details: { instrumentId, level } });
    return resource;
};

/** file: { path (relative to UPLOADS_DIR), originalName, size } */
const addPdf = async ({ instrumentId, level, title, file, actor }) => {
    await assertEditable(instrumentId, level);
    const fallback = file.originalName.replace(/\.pdf$/i, '');
    const resource = await LevelResource.create({
        instrumentId, level, kind: 'pdf', title: cleanTitle(title, fallback),
        filePath: file.path, fileName: file.originalName, fileSize: file.size, createdById: actor.id,
    });
    await logAudit({ entityType: 'level_resource', entityId: resource.id, action: 'crear', actorId: actor.id, details: { instrumentId, level } });
    return resource;
};

/** Deletes an attachment. Returns the stored file path (if any) so the caller removes the file. */
const removeResource = async ({ id, actor }) => {
    const resource = await LevelResource.findByPk(id);
    if (!resource) throw new DomainError('adjunto_no_encontrado', 'Adjunto no encontrado.', 404);
    const { filePath } = resource;
    await resource.destroy();
    await logAudit({ entityType: 'level_resource', entityId: id, action: 'borrar', actorId: actor.id });
    return { filePath };
};

/** The PDF of an attachment, for whoever can read the instrument's guide. */
const getResourceFile = async ({ id, actor }) => {
    const resource = await LevelResource.findByPk(id);
    if (!resource || resource.kind !== 'pdf') throw new DomainError('adjunto_no_encontrado', 'Adjunto no encontrado.', 404);
    if (!(await canViewGuide(actor, resource.instrumentId))) {
        throw new DomainError('sin_permiso', 'No tienes acceso a este documento.', 403);
    }
    return resource;
};

module.exports = {
    canViewGuide,
    assertEditable,
    getGuide,
    saveRequirement,
    addLink,
    addPdf,
    removeResource,
    getResourceFile,
};
