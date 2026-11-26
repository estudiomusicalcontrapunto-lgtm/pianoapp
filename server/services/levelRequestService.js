// Level-up requests ("solicitudes de ascenso"). The teacher asks, sending the three
// pieces (A, B and C) as videos or asking for a showcase; only the academy's
// approval changes the student's level.
const { Op } = require('sequelize');
const { sequelize, LevelRequest, User } = require('../models');
const { LEVEL_REQUEST_MODALITY, LEVEL_REQUEST_STATUS } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { levelIndex, levelLabel, normalizePieces } = require('../domain/levels');
const { formatInstant } = require('../domain/time');
const { createNotice } = require('./noticeService');
const { getLadder } = require('./levelLadderService');
const { logAudit } = require('./audit');

const OPEN_STATUSES = [LEVEL_REQUEST_STATUS.PENDIENTE, LEVEL_REQUEST_STATUS.MUESTRA_PROGRAMADA];

const include = [
    { model: User, as: 'student', attributes: ['id', 'name', 'level', 'teacherId'] },
    { model: User, as: 'teacher', attributes: ['id', 'name'] },
];

const loadRequest = async (id, transaction) => {
    const request = await LevelRequest.findByPk(id, { include, transaction });
    if (!request) throw new DomainError('solicitud_no_encontrada', 'Solicitud de ascenso no encontrada.', 404);
    return request;
};

const assertOpen = (request) => {
    if (!OPEN_STATUSES.includes(request.status)) {
        throw new DomainError('solicitud_cerrada', 'Esta solicitud ya está cerrada.', 409);
    }
};

const academyIds = async (transaction) =>
    (await User.findAll({ where: { role: 'academy', active: true }, attributes: ['id'], transaction })).map(u => u.id);

// "al nivel 4" or "a Prodigy", to read "pasar ..." or "el ascenso de Sofía ..."
const toLevelText = (request) => (Number.isNaN(Number(request.toLevel)) ? `a ${request.toLevel}` : `al nivel ${request.toLevel}`);

/** Academy: every request. Teacher: those of the students assigned to them. */
const listLevelRequests = async ({ actor, studentId, open }) => {
    const where = {};
    if (studentId) where.studentId = studentId;
    if (open) where.status = { [Op.in]: OPEN_STATUSES };
    const studentWhere = actor.role === 'teacher' ? { teacherId: actor.id } : undefined;
    return LevelRequest.findAll({
        where,
        include: [{ ...include[0], where: studentWhere }, include[1]],
        order: [['createdAt', 'DESC']],
    });
};

/** The teacher asks for one of their students: { studentId, modality, toLevel, pieces, notes? } */
const createLevelRequest = async ({ data, actor }) => {
    const student = await User.findOne({ where: { id: data.studentId, role: 'student', active: true } });
    if (!student || student.teacherId !== actor.id) {
        throw new DomainError('estudiante_no_encontrado', 'Estudiante no encontrado.', 404);
    }
    if (!Object.values(LEVEL_REQUEST_MODALITY).includes(data.modality)) {
        throw new DomainError('modalidad_invalida', 'Elige si se envían videos o se pide una muestra.');
    }
    const ladder = await getLadder(student.instrumentId);
    const target = levelIndex(data.toLevel, ladder);
    if (target < 0 || target <= levelIndex(student.level, ladder)) {
        throw new DomainError('nivel_invalido', 'El nivel al que aspira debe ser superior al actual.');
    }
    const checked = normalizePieces(data.pieces, data.modality);
    if (!checked.ok) throw new DomainError('obras_invalidas', checked.message);

    return sequelize.transaction(async (transaction) => {
        const open = await LevelRequest.count({ where: { studentId: student.id, status: { [Op.in]: OPEN_STATUSES } }, transaction });
        if (open) throw new DomainError('solicitud_abierta', `${student.name} ya tiene una solicitud de ascenso en curso.`, 409);

        const request = await LevelRequest.create({
            studentId: student.id,
            teacherId: actor.id,
            fromLevel: student.level,
            toLevel: String(data.toLevel),
            modality: data.modality,
            pieces: checked.pieces,
            notes: data.notes?.trim() || null,
        }, { transaction });
        await logAudit({
            entityType: 'level_request', entityId: request.id, action: 'crear', toStatus: request.status, actorId: actor.id,
            details: { studentId: student.id, fromLevel: student.level, toLevel: request.toLevel, modality: request.modality },
        }, { transaction });
        await createNotice({
            category: 'ascenso_solicitado',
            title: 'Solicitud de ascenso',
            message: data.modality === LEVEL_REQUEST_MODALITY.VIDEOS
                ? `${actor.name} envió los videos de ${student.name} para pasar ${toLevelText(request)}. Revísalos en Ascensos.`
                : `${actor.name} pide una muestra para que ${student.name} pase ${toLevelText(request)}. Prográmala en Ascensos.`,
            recipientIds: await academyIds(transaction),
            authorId: actor.id,
            meta: { levelRequestId: request.id },
        }, { transaction });
        return request;
    });
};

/** The teacher withdraws an open request. */
const cancelLevelRequest = async ({ id, actor }) => {
    return sequelize.transaction(async (transaction) => {
        const request = await loadRequest(id, transaction);
        // The teacher who sent it, or the student's current one after a change of teacher
        if (request.teacherId !== actor.id && request.student.teacherId !== actor.id) throw new DomainError('solicitud_no_encontrada', 'Solicitud de ascenso no encontrada.', 404);
        assertOpen(request);
        const from = request.status;
        await request.update({ status: LEVEL_REQUEST_STATUS.CANCELADA }, { transaction });
        await logAudit({ entityType: 'level_request', entityId: id, action: 'cancelar', fromStatus: from, toStatus: request.status, actorId: actor.id }, { transaction });
        // The student only hears about it if a showcase was already on their calendar
        await createNotice({
            category: 'ascenso_cancelado',
            title: 'Solicitud de ascenso cancelada',
            message: `${actor.name} canceló la solicitud de ascenso de ${request.student.name} ${toLevelText(request)}.`
                + (from === LEVEL_REQUEST_STATUS.MUESTRA_PROGRAMADA ? ' La muestra programada no se realizará.' : ''),
            recipientIds: [
                ...await academyIds(transaction),
                ...(from === LEVEL_REQUEST_STATUS.MUESTRA_PROGRAMADA ? [request.studentId] : []),
            ],
            authorId: actor.id,
            meta: { levelRequestId: id },
        }, { transaction });
        return request;
    });
};

/** The academy sets (or changes) the showcase: { showcaseAt, showcasePlace } */
const scheduleShowcase = async ({ id, showcaseAt, showcasePlace, actor }) => {
    if (!showcaseAt || Number.isNaN(Date.parse(showcaseAt))) throw new DomainError('fecha_invalida', 'Indica la fecha y hora de la muestra.');
    if (!showcasePlace || !showcasePlace.trim()) throw new DomainError('lugar_requerido', 'Indica el lugar de la muestra.');

    return sequelize.transaction(async (transaction) => {
        const request = await loadRequest(id, transaction);
        assertOpen(request);
        if (request.modality !== LEVEL_REQUEST_MODALITY.MUESTRA) {
            throw new DomainError('no_es_muestra', 'Esta solicitud se revisa por videos, no con una muestra.');
        }
        const from = request.status;
        await request.update({
            status: LEVEL_REQUEST_STATUS.MUESTRA_PROGRAMADA,
            showcaseAt: new Date(showcaseAt),
            showcasePlace: showcasePlace.trim(),
        }, { transaction });
        await logAudit({
            entityType: 'level_request', entityId: id, action: 'programar_muestra', fromStatus: from, toStatus: request.status, actorId: actor.id,
            details: { showcaseAt: request.showcaseAt, showcasePlace: request.showcasePlace },
        }, { transaction });
        const when = `${formatInstant(request.showcaseAt)}, en ${request.showcasePlace}`;
        const changed = from === LEVEL_REQUEST_STATUS.MUESTRA_PROGRAMADA;
        await createNotice({
            category: 'muestra_programada',
            title: changed ? 'Muestra reprogramada' : 'Muestra programada',
            message: `Tu muestra para pasar ${toLevelText(request)} es el ${when}.`,
            recipientIds: [request.studentId],
            authorId: actor.id,
            meta: { levelRequestId: id },
        }, { transaction });
        await createNotice({
            category: 'muestra_programada',
            title: changed ? 'Muestra reprogramada' : 'Muestra programada',
            message: `La muestra de ${request.student.name} para pasar ${toLevelText(request)} es el ${when}.`,
            recipientIds: [request.teacherId],
            authorId: actor.id,
            meta: { levelRequestId: id },
        }, { transaction });
        return request;
    });
};

/**
 * The academy approves: the student moves to the requested level. Videos are
 * approved straight away; a showcase must have been scheduled first.
 */
const approveLevelRequest = async ({ id, note, actor, now = new Date() }) => {
    return sequelize.transaction(async (transaction) => {
        const request = await loadRequest(id, transaction);
        assertOpen(request);
        if (request.modality === LEVEL_REQUEST_MODALITY.MUESTRA && request.status !== LEVEL_REQUEST_STATUS.MUESTRA_PROGRAMADA) {
            throw new DomainError('muestra_sin_programar', 'Primero programa la muestra.');
        }
        const student = await User.findByPk(request.studentId, { transaction });
        const ladder = await getLadder(student.instrumentId, { transaction });
        if (levelIndex(request.toLevel, ladder) < 0) {
            throw new DomainError('nivel_invalido', `${levelLabel(request.toLevel)} ya no es un nivel de su instrumento. Rechaza esta solicitud.`, 409);
        }
        if (levelIndex(request.toLevel, ladder) <= levelIndex(student.level, ladder)) {
            throw new DomainError('nivel_desactualizado', `${student.name} ya está en ${levelLabel(student.level)}. Rechaza esta solicitud.`, 409);
        }

        const from = request.status;
        const previousLevel = student.level;
        await student.update({ level: request.toLevel }, { transaction });
        await request.update({
            status: LEVEL_REQUEST_STATUS.APROBADA,
            decisionReason: note?.trim() || null,
            decidedById: actor.id,
            decidedAt: now,
        }, { transaction });
        await logAudit({
            entityType: 'level_request', entityId: id, action: 'aprobar', fromStatus: from, toStatus: request.status, actorId: actor.id,
            details: { studentId: student.id, fromLevel: previousLevel, toLevel: request.toLevel },
        }, { transaction });

        const comment = request.decisionReason ? ` Comentario de la academia: ${request.decisionReason}` : '';
        await createNotice({
            category: 'ascenso_aprobado',
            title: '¡Subiste de nivel!',
            message: `La academia aprobó tu ascenso. Ahora estás en ${levelLabel(request.toLevel)}.${comment}`,
            recipientIds: [student.id],
            authorId: actor.id,
            meta: { levelRequestId: id },
        }, { transaction });
        await createNotice({
            category: 'ascenso_aprobado',
            title: 'Ascenso aprobado',
            message: `${student.name} pasó a ${levelLabel(request.toLevel)}.${comment}`,
            recipientIds: [request.teacherId],
            authorId: actor.id,
            meta: { levelRequestId: id },
        }, { transaction });
        return request;
    });
};

/** The academy rejects with a reason; the teacher can send a new request later. */
const rejectLevelRequest = async ({ id, reason, actor, now = new Date() }) => {
    if (!reason || !reason.trim()) throw new DomainError('motivo_requerido', 'Indica el motivo del rechazo.');
    return sequelize.transaction(async (transaction) => {
        const request = await loadRequest(id, transaction);
        assertOpen(request);
        const from = request.status;
        await request.update({
            status: LEVEL_REQUEST_STATUS.RECHAZADA,
            decisionReason: reason.trim(),
            decidedById: actor.id,
            decidedAt: now,
        }, { transaction });
        await logAudit({ entityType: 'level_request', entityId: id, action: 'rechazar', fromStatus: from, toStatus: request.status, actorId: actor.id }, { transaction });
        await createNotice({
            category: 'ascenso_rechazado',
            title: 'Ascenso no aprobado',
            message: `La academia no aprobó el ascenso de ${request.student.name} ${toLevelText(request)}. Motivo: ${request.decisionReason}`,
            recipientIds: [request.teacherId],
            authorId: actor.id,
            meta: { levelRequestId: id },
        }, { transaction });
        return request;
    });
};

module.exports = {
    OPEN_STATUSES, listLevelRequests, createLevelRequest, cancelLevelRequest, scheduleShowcase, approveLevelRequest, rejectLevelRequest,
};
