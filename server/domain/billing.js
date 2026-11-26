// Monthly billing: what is charged, when it is due, and what happens when it is not paid.
//
// - Mensualidad: everyone pays on day 1, with time until dia_limite_pago (5).
// - First charge of a new student: from the date of their first class to the
//   end of the month, every time the class day falls (holidays included) is
//   charged as a single class, never more than the monthly fee. With 1 class
//   left (or none) the app suggests starting on the 1st of next month; if the
//   student starts anyway, that one class is a clase suelta.
// - From day dia_limite_pago + 1 an unpaid month blocks booking and frees the
//   student's time. A receipt sent in time and still under review does not block.
//   A receipt rejected after the deadline gives dias_extra_comprobante_rechazado
//   more days to send another one.
// - Classes taken in the month before the student lost their time unpaid are
//   charged as single classes (a debt to pay before getting a new time).
const { addDays, addMonths, monthOf, dayOfMonth, localDate, formatDay } = require('./time');
const { CLASSES_PER_MONTH } = require('./pricing');
const { remainingInMonth, occurrencesInMonth } = require('./monthly');

const PAYMENT_TYPE = {
    MENSUALIDAD: 'mensualidad',
    PROPORCIONAL: 'proporcional',
    CLASE_SUELTA: 'clase_suelta',
};

const PAYMENT_STATUS = {
    POR_PAGAR: 'por_pagar',
    EN_REVISION: 'en_revision',
    APROBADO: 'aprobado',
    RECHAZADO: 'rechazado',
    ANULADO: 'anulado',
};

const monthlyDueDate = (period, settings) => dayOfMonth(period, settings.dia_limite_pago);

/**
 * The mensualidad of a month. discounts: adjustments that lower it (e.g. a
 * class the teacher cancelled and did not make up), each { id?, amount (negative), reason }.
 */
const monthlyCharge = ({ period, prices, settings, discounts = [], today = null }) => {
    const discountTotal = discounts.reduce((sum, d) => sum + Math.abs(d.amount), 0);
    // A mensualidad made late in the month (e.g. by hand) still gives the student time to pay
    const standard = monthlyDueDate(period, settings);
    const late = today ? addDays(today, settings.dias_pago_primer_cobro) : null;
    return {
        type: PAYMENT_TYPE.MENSUALIDAD,
        period,
        amount: Math.max(0, prices.monthlyFee - discountTotal),
        dueDate: late && late > standard ? late : standard,
        calculation: {
            monthlyFee: prices.monthlyFee,
            discounts: discounts.map(d => ({ id: d.id || null, amount: -Math.abs(d.amount), reason: d.reason })),
        },
    };
};

/**
 * The first charge of a new student whose first class is on startDate (a day of
 * their weekly class). assignedDate is the day the teacher gave them the time.
 * Returns:
 * - { suggestNextMonth: false, charge, classes, makeupWeeks } with 2 or more classes left;
 * - { suggestNextMonth: true, nextMonthStart, nextMonthCharge, startAnyway } with 1 or none,
 *   where startAnyway is the clase suelta for that one class (null when none is left).
 */
const firstCharge = ({ startDate, weekday, prices, settings, assignedDate = startDate }) => {
    const period = monthOf(startDate);
    const remaining = remainingInMonth(startDate, weekday);
    const dueDate = addDays(assignedDate, settings.dias_pago_primer_cobro);

    if (remaining.length <= 1) {
        const nextPeriod = addMonths(period, 1);
        return {
            suggestNextMonth: true,
            remaining,
            nextMonthStart: occurrencesInMonth(nextPeriod, weekday)[0],
            nextMonthCharge: monthlyCharge({ period: nextPeriod, prices, settings }),
            startAnyway: remaining.length === 1
                ? {
                    type: PAYMENT_TYPE.CLASE_SUELTA,
                    period,
                    lessonDate: remaining[0],
                    amount: prices.singleClassFee,
                    dueDate,
                    calculation: { singleClassFee: prices.singleClassFee, classes: 1 },
                }
                : null,
        };
    }

    const uncapped = remaining.length * prices.singleClassFee;
    const capped = uncapped > prices.monthlyFee;
    const coversAll = !!settings.mensualidad_cubre_todas_las_clases;
    // More than 4 left: like everyone, the 5th week is for make-ups (unless the fee covers all)
    const classes = coversAll ? remaining : remaining.slice(0, CLASSES_PER_MONTH);
    return {
        suggestNextMonth: false,
        classes,
        makeupWeeks: coversAll ? [] : remaining.slice(CLASSES_PER_MONTH),
        charge: {
            type: PAYMENT_TYPE.PROPORCIONAL,
            period,
            amount: capped ? prices.monthlyFee : uncapped,
            dueDate,
            calculation: {
                classesLeft: remaining.length,
                dates: remaining,
                singleClassFee: prices.singleClassFee,
                uncapped,
                monthlyFee: prices.monthlyFee,
                capped,
            },
        },
    };
};

// A single class bought apart (e.g. an extra class)
const singleClassCharge = ({ lessonDate, prices, dueDate = lessonDate }) => ({
    type: PAYMENT_TYPE.CLASE_SUELTA,
    period: monthOf(lessonDate),
    lessonDate,
    amount: prices.singleClassFee,
    dueDate,
    calculation: { singleClassFee: prices.singleClassFee, classes: 1 },
});

/**
 * Several single classes of one month that the academy gives a student: one
 * charge (one receipt) for all of them, never more than the monthly fee.
 * Due dias_pago_primer_cobro days after. The teacher books them afterwards.
 */
const singleClassesCharge = ({ count, period, prices, settings, today }) => {
    const uncapped = count * prices.singleClassFee;
    const capped = uncapped > prices.monthlyFee;
    return {
        type: PAYMENT_TYPE.CLASE_SUELTA,
        period,
        amount: capped ? prices.monthlyFee : uncapped,
        dueDate: addDays(today, settings.dias_pago_primer_cobro),
        calculation: { classes: count, singleClassFee: prices.singleClassFee, uncapped, monthlyFee: prices.monthlyFee, capped },
    };
};

const daysBetween = (fromDate, toDate) =>
    Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);

/**
 * Last day to pay. A receipt rejected on or after the due date gives
 * dias_extra_comprobante_rechazado more days from the rejection.
 * payment: { dueDate, status, reviewedAt? }
 */
const paymentDeadline = (payment, settings) => {
    if (payment.status === PAYMENT_STATUS.RECHAZADO && payment.reviewedAt) {
        const rejectedOn = localDate(payment.reviewedAt);
        if (rejectedOn >= payment.dueDate) {
            const extended = addDays(rejectedOn, settings.dias_extra_comprobante_rechazado);
            return extended > payment.dueDate ? extended : payment.dueDate;
        }
    }
    return payment.dueDate;
};

/**
 * Where a payment stands today.
 * state: al_dia | en_revision | pendiente | vencido | anulado.
 * blocks: true when the student can no longer book and loses their time.
 */
const paymentStanding = ({ payment, now, settings }) => {
    if (payment.status === PAYMENT_STATUS.APROBADO) return { state: 'al_dia', blocks: false };
    if (payment.status === PAYMENT_STATUS.ANULADO) return { state: 'anulado', blocks: false };
    // Sent in time: the academy has not reviewed it yet, the student keeps their time
    if (payment.status === PAYMENT_STATUS.EN_REVISION) return { state: 'en_revision', blocks: false };

    const today = localDate(now);
    const deadline = paymentDeadline(payment, settings);
    if (today <= deadline) {
        const daysLeft = daysBetween(today, deadline);
        return {
            state: 'pendiente',
            blocks: false,
            deadline,
            daysLeft,
            message: daysLeft === 0
                ? 'Hoy es el último día para pagar.'
                : `Tienes hasta el ${formatDay(deadline)} para pagar (${daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft} días`}).`,
        };
    }
    return {
        state: 'vencido',
        blocks: true,
        deadline,
        message: `El plazo para pagar venció el ${formatDay(deadline)}. Ya no puedes agendar y tu horario quedó libre. Comunícate con la academia.`,
    };
};

/** Classes taken before losing the time unpaid: each one is a clase suelta owed. lessons: [{ id, startsAt }] */
const unpaidClassesDebt = ({ takenLessons, prices }) =>
    takenLessons.map(lesson => ({
        type: PAYMENT_TYPE.CLASE_SUELTA,
        period: monthOf(localDate(lesson.startsAt)),
        lessonId: lesson.id,
        amount: prices.singleClassFee,
        dueDate: localDate(lesson.startsAt),
        calculation: { singleClassFee: prices.singleClassFee, classes: 1, reason: 'Clase tomada sin pagar la mensualidad' },
    }));

module.exports = {
    PAYMENT_TYPE,
    PAYMENT_STATUS,
    monthlyDueDate,
    monthlyCharge,
    firstCharge,
    singleClassCharge,
    singleClassesCharge,
    paymentDeadline,
    paymentStanding,
    unpaidClassesDebt,
    daysBetween,
};
