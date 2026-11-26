// Class rules of the monthly model.
//
// Student:
// - Changes a class with at least horas_minimas_aviso (12) hours of notice, as
//   many times as they want (optional monthly cap: tope_cambios_mes, 0 = none).
//   Changing means picking right away a free make-up slot ("franja de
//   reposición") of their teacher in the same month as the class.
// - A make-up cannot be changed: if they cancel it or miss it, it is lost.
// - A make-up must start at least horas_minimas_aviso hours from now.
// - Missing a class without changing it in time: the class is lost.
// - With the month unpaid after the deadline they cannot book.
// Teacher:
// - May move a student's class to any free time in the same month until it
//   starts (no 12-hour rule). It is not a cancellation.
// - A class they cancel is always made up: they book it in any free time, until
//   the end of the next month. If it is not given by then, the value of a
//   single class is discounted from the student's next payment.
const { LESSON_STATUS, LESSON_KIND } = require('./constants');
const { ok, fail } = require('./errors');
const { hasSubstitute } = require('./absences');
const {
    addHours, localParts, localDate, addDays, addMonths, monthOf, lastDayOfMonth, formatDay, formatMonth, formatTime12,
} = require('./time');

const changeDeadline = (lesson, settings) => addHours(lesson.startsAt, -settings.horas_minimas_aviso);

// "a las 7:00 p.m." already ends in a period
const sentence = (text) => (text.endsWith('.') ? text : `${text}.`);

// "hoy a las 7:00 p.m.", "mañana a las 10:00 a.m.", "el domingo 13 de junio a las 7:00 p.m."
const describeInstant = (instant, now) => {
    const { date, time } = localParts(instant);
    const today = localDate(now);
    const at = `a las ${formatTime12(time)}`;
    if (date === today) return `hoy ${at}`;
    if (date === addDays(today, 1)) return `mañana ${at}`;
    return `el ${formatDay(date)} ${at}`;
};

/**
 * Can the student change this class now?
 * changesThisMonth: classes the student already changed this month (for the optional cap).
 * Returns ok({ deadline, message }) or a failure with a message for the student.
 */
const checkStudentChange = ({ lesson, now, settings, changesThisMonth = 0, paymentBlocked = false, termsPending = false }) => {
    if (lesson.status !== LESSON_STATUS.PROGRAMADA || new Date(lesson.startsAt) <= new Date(now)) {
        return fail('clase_no_programada', 'Esta clase ya no se puede cambiar.');
    }
    if (lesson.kind === LESSON_KIND.REPOSICION) {
        return fail('reposicion_no_cambia', 'Esta clase es una reposición y no se puede cambiar. Si no puedes asistir, se pierde.');
    }
    if (hasSubstitute(lesson)) {
        return fail('clase_con_reemplazo', 'Esta clase la da un profesor de reemplazo, así que no se puede cambiar. Si necesitas cambiarla, habla con la academia.');
    }
    if (termsPending) {
        return fail('terminos_pendientes', 'Para cambiar clases, primero acepta los términos y condiciones de la academia.', 403);
    }
    if (paymentBlocked) {
        return fail('pago_vencido', 'No puedes cambiar clases porque la mensualidad de este mes no está paga. Comunícate con la academia.');
    }
    const deadline = changeDeadline(lesson, settings);
    if (new Date(now) > deadline) {
        return fail(
            'plazo_vencido',
            sentence(`Ya pasó el plazo para cambiar esta clase: se podía hasta ${describeInstant(deadline, now)}`)
        );
    }
    const cap = settings.tope_cambios_mes || 0;
    if (cap > 0 && changesThisMonth >= cap) {
        return fail('tope_mensual', `Ya cambiaste ${changesThisMonth} ${changesThisMonth === 1 ? 'clase' : 'clases'} este mes, que es el máximo.`);
    }
    return ok({ deadline, message: sentence(`Puedes cambiar esta clase hasta ${describeInstant(deadline, now)}`) });
};

/** Range where make-up slots for a class are offered: from now + notice hours to the end of the class's month. */
const studentMakeupRange = (original, now, settings) => ({
    from: addHours(now, settings.horas_minimas_aviso),
    toDate: lastDayOfMonth(monthOf(localDate(original.startsAt))),
});

/** The new time a student picks for a class: same month, at least the notice hours ahead. */
const checkStudentMakeupTarget = ({ original, startsAt, now, settings }) => {
    const month = monthOf(localDate(original.startsAt));
    if (monthOf(localDate(startsAt)) !== month) {
        return fail('fuera_del_mes', `La reposición tiene que ser en ${formatMonth(month)}, el mismo mes de la clase.`);
    }
    if (new Date(startsAt) < addHours(now, settings.horas_minimas_aviso)) {
        return fail(
            'reposicion_muy_pronto',
            `Ese horario empieza muy pronto: las reposiciones se agendan con al menos ${settings.horas_minimas_aviso} horas de anticipación.`
        );
    }
    return ok();
};

/** The teacher moves a student's class: until it starts, to a later time in the same month. */
const checkTeacherMove = ({ lesson, startsAt, now }) => {
    if (lesson.status !== LESSON_STATUS.PROGRAMADA) {
        return fail('clase_no_programada', 'Solo se pueden mover clases programadas.');
    }
    if (new Date(lesson.startsAt) <= new Date(now)) {
        return fail('clase_pasada', 'Esta clase ya empezó, así que no se puede mover.');
    }
    if (new Date(startsAt) <= new Date(now)) {
        return fail('horario_pasado', 'El nuevo horario ya pasó.');
    }
    const month = monthOf(localDate(lesson.startsAt));
    if (monthOf(localDate(startsAt)) !== month) {
        return fail('fuera_del_mes', `La clase se puede mover dentro de ${formatMonth(month)}.`);
    }
    return ok();
};

// Who owes a pending make-up: the teacher (cancelled by them) or the student's own change
const makeupOrigin = (lesson) =>
    [LESSON_STATUS.CANCELADA_POR_PROFESOR, LESSON_STATUS.CANCELADA_POR_ACADEMIA].includes(lesson.status) && !lesson.moved
        ? 'profesor'
        : 'alumno';

/**
 * Last day a pending make-up can be given:
 * - the student's: within the same month (it is gone on the 1st of the next one);
 * - the teacher's: until the end of the next month.
 */
const pendingMakeupDeadline = (lesson) => {
    const month = monthOf(localDate(lesson.startsAt));
    return makeupOrigin(lesson) === 'profesor' ? lastDayOfMonth(addMonths(month, 1)) : lastDayOfMonth(month);
};

const isPendingMakeupExpired = (lesson, now) => localDate(now) > pendingMakeupDeadline(lesson);

/**
 * Pending make-ups whose time ran out. The student's are just lost; for each
 * one the teacher owed, a single class is discounted from the next payment.
 * Returns { lost: [lesson], discounts: [{ lessonId, studentId, amount, reason }] }.
 */
const planPendingMakeupExpiry = ({ pending, now, pricesOf }) => {
    const expired = pending.filter(l => isPendingMakeupExpired(l, now));
    const lost = expired.filter(l => makeupOrigin(l) === 'alumno');
    const discounts = expired.filter(l => makeupOrigin(l) === 'profesor').map(l => {
        const amount = pricesOf(l).singleClassFee;
        return {
            lessonId: l.id,
            studentId: l.studentId,
            kind: 'descuento_clase_no_repuesta',
            amount: -amount,
            reason: `Clase del ${formatDay(localDate(l.startsAt))} cancelada por el profesor y no repuesta antes del ${formatDay(pendingMakeupDeadline(l))}.`,
        };
    });
    return { lost, discounts };
};

module.exports = {
    changeDeadline,
    describeInstant,
    checkStudentChange,
    studentMakeupRange,
    checkStudentMakeupTarget,
    checkTeacherMove,
    makeupOrigin,
    pendingMakeupDeadline,
    isPendingMakeupExpired,
    planPendingMakeupExpiry,
};
