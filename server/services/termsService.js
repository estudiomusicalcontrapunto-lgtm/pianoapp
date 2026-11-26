// Terms and conditions: versions the academy publishes and each student's acceptance.
const { sequelize, TermsVersion, TermsAcceptance, User } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { termsStatus } = require('../domain/terms');
const { localDate, formatDay } = require('../domain/time');
const { logAudit } = require('./audit');
const { createNotice } = require('./noticeService');

const plain = (row) => row.get({ plain: true });

const currentVersion = async ({ transaction } = {}) =>
    TermsVersion.findOne({ order: [['version', 'DESC']], transaction });

/** Where a user stands with the current terms. Only students must accept them. */
const statusFor = async (user, { now = new Date() } = {}) => {
    if (user.role !== ROLES.STUDENT) return { required: false };
    const version = await currentVersion();
    const acceptance = version && await TermsAcceptance.findOne({ where: { userId: user.id }, order: [['acceptedAt', 'DESC']] });
    return termsStatus({
        version: version && plain(version),
        acceptance: acceptance && plain(acceptance),
        accountCreatedAt: user.createdAt,
        today: localDate(now),
    });
};

/** For scheduling: a student who has not accepted the current terms cannot book or change classes. */
const assertTermsAccepted = async (user, { now = new Date() } = {}) => {
    const status = await statusFor(user, { now });
    if (status.required) {
        throw new DomainError('terminos_pendientes', 'Para cambiar o agendar clases, primero acepta los términos y condiciones de la academia.', 403);
    }
};

const ACCEPT_BY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The academy publishes a new version (the text is never edited in place). */
const publishTerms = async ({ content, acceptBy = null, actor, now = new Date() }) => {
    const text = String(content || '').trim();
    if (text.length < 20) throw new DomainError('terminos_vacios', 'Escribe el texto de los términos y condiciones.');
    if (acceptBy && (!ACCEPT_BY_PATTERN.test(acceptBy) || acceptBy < localDate(now))) {
        throw new DomainError('fecha_invalida', 'La fecha límite para aceptar debe ser hoy o un día futuro.');
    }
    const created = await sequelize.transaction(async (transaction) => {
        const last = await currentVersion({ transaction });
        const version = await TermsVersion.create({
            version: (last?.version || 0) + 1, content: text, acceptBy: acceptBy || null, publishedById: actor.id,
        }, { transaction });
        await logAudit({ entityType: 'terms', entityId: version.id, action: 'publicar', actorId: actor.id, details: { version: version.version, acceptBy } }, { transaction });
        return version;
    });
    const students = await User.findAll({ where: { role: ROLES.STUDENT, active: true }, attributes: ['id'] });
    await createNotice({
        category: 'terminos',
        title: 'Términos y condiciones actualizados',
        message: 'La academia publicó una nueva versión de los términos y condiciones. Léelos y acéptalos en la app'
            + (acceptBy ? ` a más tardar el ${formatDay(acceptBy)}.` : '.'),
        recipientIds: students.map(s => s.id),
        authorId: actor.id,
    });
    return plain(created);
};

/** The student accepts the current version: the date, time and version are recorded. */
const acceptTerms = async ({ user, versionId, ipAddress = null, userAgent = null, now = new Date() }) => {
    if (user.role !== ROLES.STUDENT) throw new DomainError('sin_permiso', 'Solo los estudiantes aceptan los términos.', 403);
    const version = await currentVersion();
    if (!version) throw new DomainError('sin_terminos', 'No hay términos publicados.', 404);
    if (versionId && versionId !== version.id) {
        throw new DomainError('terminos_desactualizados', 'Los términos cambiaron mientras los leías. Revisa la versión nueva y acéptala.', 409);
    }
    const existing = await TermsAcceptance.findOne({ where: { userId: user.id, termsVersionId: version.id } });
    if (existing) return plain(existing);
    const acceptance = await TermsAcceptance.create({
        userId: user.id, termsVersionId: version.id, version: version.version, acceptedAt: new Date(now),
        ipAddress, userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
    });
    await logAudit({ entityType: 'terms', entityId: version.id, action: 'aceptar', actorId: user.id, details: { version: version.version } });
    return plain(acceptance);
};

/** Versions with how many active students accepted each, and who is missing the current one. */
const termsOverview = async () => {
    const versions = await TermsVersion.findAll({ order: [['version', 'DESC']] });
    const students = await User.findAll({ where: { role: ROLES.STUDENT, active: true }, attributes: ['id', 'name'], order: [['name', 'ASC']] });
    const acceptances = await TermsAcceptance.findAll();
    const current = versions[0] || null;
    const acceptedCurrent = new Map(acceptances.filter(a => current && a.termsVersionId === current.id).map(a => [a.userId, a.acceptedAt]));
    return {
        current: current && plain(current),
        versions: versions.map(v => ({ ...plain(v), acceptedCount: acceptances.filter(a => a.termsVersionId === v.id).length })),
        students: students.map(s => ({ id: s.id, name: s.name, acceptedAt: acceptedCurrent.get(s.id) || null })),
    };
};

module.exports = { currentVersion, statusFor, assertTermsAccepted, publishTerms, acceptTerms, termsOverview };
