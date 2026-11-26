// Who reads an announcement and until when. Plain functions, testable without a database.
const { ROLES } = require('./constants');
const { addDays } = require('./time');
const { ok, fail } = require('./errors');

const AUDIENCE = {
    TODOS: 'todos', // Every student and teacher (academy only)
    ESTUDIANTES: 'estudiantes', // Every student (academy only)
    PROFESORES: 'profesores', // Every teacher (academy only)
    MIS_ESTUDIANTES: 'mis_estudiantes', // The author's students (a teacher)
};

const ACADEMY_AUDIENCES = [AUDIENCE.TODOS, AUDIENCE.ESTUDIANTES, AUDIENCE.PROFESORES];

const MAX_TITLE = 120;
const MAX_CONTENT = 2000;
const MAX_DAYS_AHEAD = 365;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Does this user read the announcement? Students read the academy's announcements
 * for students and their own teacher's; teachers read the academy's for teachers.
 * user: { id, role, teacherId }; announcement: { audience, teacherId (author) }
 */
const isReader = (user, announcement) => {
    const { audience } = announcement;
    if (user.role === ROLES.STUDENT) {
        return audience === AUDIENCE.TODOS || audience === AUDIENCE.ESTUDIANTES ||
            (audience === AUDIENCE.MIS_ESTUDIANTES && !!user.teacherId && announcement.teacherId === user.teacherId);
    }
    if (user.role === ROLES.TEACHER) return audience === AUDIENCE.TODOS || audience === AUDIENCE.PROFESORES;
    return false;
};

// Still shown in the notices on that local day (visibleUntil is inclusive)
const isCurrent = (announcement, today) => !announcement.visibleUntil || announcement.visibleUntil >= today;

const canManage = (actor, announcement) =>
    actor.role === ROLES.ACADEMY || announcement.teacherId === actor.id;

/**
 * Checks and normalizes what a person writes. Partial (an edit) unless creating.
 * The audience is the teacher's students for a teacher; the academy picks one of its own.
 * Returns ok({ values }) or a failure.
 */
const normalizeAnnouncement = (input, { actor, today, defaultDays, creating }) => {
    const values = {};
    if (creating || input.title !== undefined) {
        const title = String(input.title ?? '').trim();
        if (!title) return fail('titulo_requerido', 'El anuncio necesita un título.');
        if (title.length > MAX_TITLE) return fail('titulo_largo', `El título no puede pasar de ${MAX_TITLE} caracteres.`);
        values.title = title;
    }
    if (creating || input.content !== undefined) {
        const content = String(input.content ?? '').trim();
        if (!content) return fail('contenido_requerido', 'Escribe el mensaje del anuncio.');
        if (content.length > MAX_CONTENT) return fail('contenido_largo', `El mensaje no puede pasar de ${MAX_CONTENT} caracteres.`);
        values.content = content;
    }
    if (creating || input.visibleUntil !== undefined) {
        const until = input.visibleUntil || addDays(today, defaultDays);
        if (!DATE_PATTERN.test(until)) return fail('fecha_invalida', 'La fecha "visible hasta" no es válida.');
        if (until < today) return fail('fecha_pasada', 'La fecha "visible hasta" no puede ser anterior a hoy.');
        if (until > addDays(today, MAX_DAYS_AHEAD)) return fail('fecha_lejana', 'Un anuncio puede mostrarse máximo un año.');
        values.visibleUntil = until;
    }
    if (actor.role === ROLES.TEACHER) {
        if (creating) values.audience = AUDIENCE.MIS_ESTUDIANTES;
    } else if (creating || input.audience !== undefined) {
        const audience = input.audience || AUDIENCE.TODOS;
        if (!ACADEMY_AUDIENCES.includes(audience)) return fail('audiencia_invalida', 'Elige para quién es el anuncio.');
        values.audience = audience;
    }
    return ok({ values });
};

module.exports = {
    AUDIENCE,
    ACADEMY_AUDIENCES,
    isReader,
    isCurrent,
    canManage,
    normalizeAnnouncement,
};
