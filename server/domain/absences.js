// Teacher absences and substitutes: plain rules, testable without a database.
const { LESSON_STATUS } = require('./constants');
const { ok, fail } = require('./errors');
const { localParts, formatDay, addDays } = require('./time');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ABSENCE_DAYS = 366;

// The absence that covers that local day for the teacher, if any
const absenceOn = (absences, teacherId, date) =>
    (absences || []).find(a => a.teacherId === teacherId && a.startDate <= date && date <= a.endDate) || null;

/** A lesson cannot be placed on a day its teacher is absent. */
const checkTeacherPresent = ({ absences, teacherId, startsAt }) => {
    const absence = absenceOn(absences, teacherId, localParts(startsAt).date);
    if (!absence) return ok();
    return fail(
        'profesor_ausente',
        `El profesor no da clases del ${formatDay(absence.startDate)} al ${formatDay(absence.endDate)}. Elige otro día.`
    );
};

/** { startDate, endDate } of a new or edited absence; it may not end in the past. */
const checkAbsenceDates = ({ startDate, endDate, today }) => {
    if (!DATE_PATTERN.test(startDate || '') || !DATE_PATTERN.test(endDate || '')) {
        return fail('fecha_invalida', 'Indica las fechas de inicio y fin de la ausencia.');
    }
    if (endDate < startDate) return fail('fechas_invertidas', 'La fecha de fin no puede ser anterior a la de inicio.');
    if (endDate < today) return fail('fecha_pasada', 'La ausencia ya terminó.');
    if (endDate > addDays(startDate, MAX_ABSENCE_DAYS)) return fail('ausencia_larga', 'Una ausencia puede durar máximo un año.');
    return ok();
};

const overlappingAbsence = (absences, { teacherId, startDate, endDate, id }) =>
    (absences || []).find(a => a.id !== id && a.teacherId === teacherId && a.startDate <= endDate && startDate <= a.endDate) || null;

/**
 * The substitute for some lessons: { teacherId } (academy teacher) or
 * { name, phone? } (outside teacher). Returns ok({ fields }) with the lesson
 * columns to write, or a failure.
 */
const normalizeSubstitute = (input) => {
    if (input?.teacherId) {
        return ok({ fields: { substituteTeacherId: input.teacherId, substituteName: null, substitutePhone: null } });
    }
    const name = String(input?.name ?? '').trim();
    if (!name) return fail('reemplazo_requerido', 'Elige un profesor de la academia o escribe el nombre del profesor externo.');
    const phone = String(input?.phone ?? '').trim();
    return ok({ fields: { substituteTeacherId: null, substituteName: name.slice(0, 120), substitutePhone: phone.slice(0, 40) || null } });
};

/** Only upcoming scheduled lessons get or lose a substitute. */
const checkSubstitutable = (lesson, now) => {
    if (lesson.status !== LESSON_STATUS.PROGRAMADA) {
        return fail('clase_no_programada', 'Solo se asigna reemplazo a clases programadas.');
    }
    if (new Date(lesson.startsAt) <= new Date(now)) {
        return fail('clase_pasada', 'Esa clase ya empezó.');
    }
    return ok();
};

const hasSubstitute = (lesson) => !!(lesson.substituteTeacherId || lesson.substituteName);

module.exports = {
    absenceOn,
    checkTeacherPresent,
    checkAbsenceDates,
    overlappingAbsence,
    normalizeSubstitute,
    checkSubstitutable,
    hasSubstitute,
};
