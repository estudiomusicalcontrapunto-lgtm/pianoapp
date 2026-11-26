// The monthly calendar. Holidays are normal days: the app does not skip them.
//
// A student has a weekly class (fixed schedule). The monthly fee covers 4 classes:
// when the class day falls a 5th time in the month, that week is left for
// make-ups (the student has no class and pays nothing extra). With the setting
// mensualidad_cubre_todas_las_clases (monthlyFeeCoversAllClasses) every
// occurrence is a class.
const { addDays, weekdayOf, monthOf, firstDayOfMonth, lastDayOfMonth } = require('./time');
const { CLASSES_PER_MONTH } = require('./pricing');

// Every date from fromDate to toDate (inclusive) that falls on the weekday (1 = lunes ... 7 = domingo)
const occurrencesBetween = (fromDate, toDate, weekday) => {
    const offset = (weekday - weekdayOf(fromDate) + 7) % 7;
    const dates = [];
    for (let d = addDays(fromDate, offset); d <= toDate; d = addDays(d, 7)) dates.push(d);
    return dates;
};

const occurrencesInMonth = (period, weekday) =>
    occurrencesBetween(firstDayOfMonth(period), lastDayOfMonth(period), weekday);

// Occurrences from a date to the end of its month, that date included if it is a class day
const remainingInMonth = (startDate, weekday) =>
    occurrencesBetween(startDate, lastDayOfMonth(monthOf(startDate)), weekday);

const fixedValidOn = (fixed, date) => (!fixed.validFrom || fixed.validFrom <= date) && (!fixed.validTo || date <= fixed.validTo);

/**
 * Which dates of a month are classes and which are left for make-ups.
 * fixed: { weekday, validFrom?, validTo? }. Only dates where the schedule is valid count.
 * Returns { classes: [date], makeupWeeks: [date] }.
 */
const monthlyClassPlan = ({ period, fixed, coversAll = false }) => {
    const dates = occurrencesInMonth(period, fixed.weekday).filter(d => fixedValidOn(fixed, d));
    if (coversAll) return { classes: dates, makeupWeeks: [] };
    return { classes: dates.slice(0, CLASSES_PER_MONTH), makeupWeeks: dates.slice(CLASSES_PER_MONTH) };
};

module.exports = { occurrencesBetween, occurrencesInMonth, remainingInMonth, monthlyClassPlan, fixedValidOn };
