// Announcements ("anuncios"): the academy publishes for everyone, for students or
// for teachers; a teacher publishes for their own students. Readers see them in
// their notices until the end date, and mark them as read.
const { Op } = require('sequelize');
const { sequelize, Announcement, AnnouncementRead } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError, assertOk } = require('../domain/errors');
const { AUDIENCE, isCurrent, canManage, normalizeAnnouncement } = require('../domain/announcements');
const { localDate, addDays } = require('../domain/time');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./audit');

// SQL version of isReader (domain/announcements.js); null when the user reads none
const readerWhere = (user) => {
    if (user.role === ROLES.STUDENT) {
        const options = [{ audience: { [Op.in]: [AUDIENCE.TODOS, AUDIENCE.ESTUDIANTES] } }];
        if (user.teacherId) options.push({ audience: AUDIENCE.MIS_ESTUDIANTES, teacherId: user.teacherId });
        return { [Op.or]: options };
    }
    if (user.role === ROLES.TEACHER) return { audience: { [Op.in]: [AUDIENCE.TODOS, AUDIENCE.PROFESORES] } };
    return null;
};

const toJSON = (announcement, today, readAt) => ({
    ...announcement.get({ plain: true }),
    reads: undefined,
    current: isCurrent(announcement, today),
    ...(readAt !== undefined && { readAt }),
});

/**
 * The announcements a user reads, newest first, each with readAt.
 * Only current ones unless includeExpired.
 */
const listForReader = async (user, { now = new Date(), includeExpired = false, limit = 100 } = {}) => {
    const where = readerWhere(user);
    if (!where) return [];
    const today = localDate(now);
    const announcements = await Announcement.findAll({
        where: includeExpired ? where : { [Op.and]: [where, { visibleUntil: { [Op.gte]: today } }] },
        include: [{ model: AnnouncementRead, as: 'reads', where: { userId: user.id }, required: false }],
        order: [['createdAt', 'DESC']],
        limit,
    });
    return announcements.map(a => toJSON(a, today, a.reads[0]?.createdAt || null));
};

/** What the author manages: the academy sees every announcement, a teacher their own. With how many read it. */
const listManaged = async (actor, { now = new Date() } = {}) => {
    const today = localDate(now);
    const announcements = await Announcement.findAll({
        where: actor.role === ROLES.ACADEMY ? {} : { teacherId: actor.id },
        order: [['createdAt', 'DESC']],
    });
    const counts = await AnnouncementRead.findAll({
        attributes: ['announcementId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        where: { announcementId: announcements.map(a => a.id) },
        group: ['announcementId'],
        raw: true,
    });
    const readCount = Object.fromEntries(counts.map(c => [c.announcementId, Number(c.count)]));
    return announcements.map(a => ({ ...toJSON(a, today), readCount: readCount[a.id] || 0 }));
};

const createAnnouncement = async ({ actor, input, now = new Date() }) => {
    if (![ROLES.ACADEMY, ROLES.TEACHER].includes(actor.role)) {
        throw new DomainError('sin_permiso', 'Solo la academia y los profesores publican anuncios.', 403);
    }
    const today = localDate(now);
    const settings = await getSettings();
    const { values } = assertOk(normalizeAnnouncement(input, { actor, today, defaultDays: settings.dias_vigencia_anuncio, creating: true }));
    const announcement = await Announcement.create({ ...values, date: today, author: actor.name, teacherId: actor.id });
    await logAudit({ entityType: 'announcement', entityId: announcement.id, action: 'publicar', actorId: actor.id, details: { audience: values.audience } });
    return toJSON(announcement, today);
};

const loadManaged = async (id, actor) => {
    const announcement = await Announcement.findByPk(id);
    if (!announcement) throw new DomainError('anuncio_no_encontrado', 'Anuncio no encontrado.', 404);
    if (!canManage(actor, announcement)) throw new DomainError('sin_permiso', 'Solo quien lo publicó o la academia puede cambiarlo.', 403);
    return announcement;
};

/** Edits title, content, end date or (academy) audience. A teacher's announcement stays for their students. */
const updateAnnouncement = async ({ id, actor, input, now = new Date() }) => {
    const announcement = await loadManaged(id, actor);
    const today = localDate(now);
    const settings = await getSettings();
    const { values } = assertOk(normalizeAnnouncement(input, { actor, today, defaultDays: settings.dias_vigencia_anuncio, creating: false }));
    if (announcement.audience === AUDIENCE.MIS_ESTUDIANTES) delete values.audience;
    await announcement.update(values);
    await logAudit({ entityType: 'announcement', entityId: id, action: 'editar', actorId: actor.id, details: values });
    return toJSON(announcement, today);
};

/** Stops showing it from today on; it stays in the history. */
const endAnnouncement = async ({ id, actor, now = new Date() }) => {
    const announcement = await loadManaged(id, actor);
    const today = localDate(now);
    await announcement.update({ visibleUntil: addDays(today, -1) });
    await logAudit({ entityType: 'announcement', entityId: id, action: 'retirar', actorId: actor.id });
    return toJSON(announcement, today);
};

const deleteAnnouncement = async ({ id, actor }) => {
    const announcement = await loadManaged(id, actor);
    await sequelize.transaction(async (transaction) => {
        await AnnouncementRead.destroy({ where: { announcementId: id }, transaction });
        await announcement.destroy({ transaction });
        await logAudit({ entityType: 'announcement', entityId: id, action: 'borrar', actorId: actor.id }, { transaction });
    });
};

/** Marks announcements as read; without ids, every current one the user reads. */
const markAnnouncementsRead = async (user, announcementIds, { now = new Date() } = {}) => {
    const readable = await listForReader(user, { now, includeExpired: !!announcementIds, limit: 500 });
    const ids = readable
        .filter(a => !a.readAt && (!announcementIds || announcementIds.includes(a.id)))
        .map(a => a.id);
    if (ids.length) {
        await AnnouncementRead.bulkCreate(ids.map(announcementId => ({ announcementId, userId: user.id })), { ignoreDuplicates: true });
    }
    return ids.length;
};

module.exports = {
    readerWhere,
    listForReader,
    listManaged,
    createAnnouncement,
    updateAnnouncement,
    endAnnouncement,
    deleteAnnouncement,
    markAnnouncementsRead,
};
