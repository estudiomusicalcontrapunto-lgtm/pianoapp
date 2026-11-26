// Dates in America/Bogota. Colombia is UTC-5 all year (no daylight saving
// since 1993), so a fixed offset is exact. Instants are stored as UTC Dates;
// calendar days are 'YYYY-MM-DD' strings and wall-clock times are 'HH:mm'.

const OFFSET_MS = 5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const WEEKDAY_NAMES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');

// "los sábados", "los lunes"
const weekdayPlural = (weekday) => (weekday >= 6 ? `${WEEKDAY_NAMES[weekday]}s` : WEEKDAY_NAMES[weekday]);

const parseDate = (dateStr) => dateStr.split('-').map(Number);

// Local day + local time -> UTC instant
const toUtc = (dateStr, timeStr = '00:00') => {
    const [year, month, day] = parseDate(dateStr);
    const [hours, minutes] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hours, minutes) + OFFSET_MS);
};

// ISO weekday: 1 = lunes ... 7 = domingo
const isoWeekday = (utcDay) => (utcDay === 0 ? 7 : utcDay);

// UTC instant -> local { date, time, weekday }
const localParts = (instant) => {
    const shifted = new Date(new Date(instant).getTime() - OFFSET_MS);
    return {
        date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
        time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
        weekday: isoWeekday(shifted.getUTCDay()),
    };
};

const localDate = (instant) => localParts(instant).date;

const addDays = (dateStr, days) => {
    const [year, month, day] = parseDate(dateStr);
    const d = new Date(Date.UTC(year, month - 1, day + days));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const weekdayOf = (dateStr) => {
    const [year, month, day] = parseDate(dateStr);
    return isoWeekday(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
};

const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

const minutesToTime = (total) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

const addMinutes = (instant, minutes) => new Date(new Date(instant).getTime() + minutes * 60 * 1000);

const addHours = (instant, hours) => new Date(new Date(instant).getTime() + hours * HOUR_MS);

const hoursBetween = (from, to) => (new Date(to).getTime() - new Date(from).getTime()) / HOUR_MS;

// Inclusive list of local days
const eachDay = (fromDate, toDate) => {
    const days = [];
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) days.push(d);
    return days;
};

// Months are 'YYYY-MM' strings ("periodos")
const monthOf = (dateStr) => dateStr.slice(0, 7);

const firstDayOfMonth = (period) => `${period}-01`;

const lastDayOfMonth = (period) => {
    const [year, month] = period.split('-').map(Number);
    const d = new Date(Date.UTC(year, month, 0));
    return `${period}-${pad(d.getUTCDate())}`;
};

const addMonths = (period, months) => {
    const [year, month] = period.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1 + months, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

// Day `day` of a month, clamped to its last day
const dayOfMonth = (period, day) => {
    const last = lastDayOfMonth(period);
    return Number(last.slice(8)) < day ? last : `${period}-${pad(day)}`;
};

// "junio de 2027"
const formatMonth = (period) => {
    const [year, month] = period.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} de ${year}`;
};

// "7:00 p.m.", "10:30 a.m."
const formatTime12 = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const suffix = hours < 12 ? 'a.m.' : 'p.m.';
    const h = hours % 12 === 0 ? 12 : hours % 12;
    return `${h}:${pad(minutes)} ${suffix}`;
};

// "lunes 3 de noviembre"
const formatDay = (dateStr) => {
    const [, month, day] = parseDate(dateStr);
    return `${WEEKDAY_NAMES[weekdayOf(dateStr)]} ${day} de ${MONTH_NAMES[month - 1]}`;
};

// "lunes 3 de noviembre, 14:00"
const formatInstant = (instant) => {
    const { date, time } = localParts(instant);
    return `${formatDay(date)}, ${time}`;
};

// "lunes 3 de noviembre, 14:00 a 15:00"
const formatRange = (startsAt, endsAt) => `${formatInstant(startsAt)} a ${localParts(endsAt).time}`;

module.exports = {
    WEEKDAY_NAMES,
    weekdayPlural,
    toUtc,
    localParts,
    localDate,
    addDays,
    weekdayOf,
    timeToMinutes,
    minutesToTime,
    addMinutes,
    addHours,
    hoursBetween,
    eachDay,
    monthOf,
    firstDayOfMonth,
    lastDayOfMonth,
    addMonths,
    dayOfMonth,
    formatMonth,
    formatTime12,
    formatDay,
    formatInstant,
    formatRange,
};
