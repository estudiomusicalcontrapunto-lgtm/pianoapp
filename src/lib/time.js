// Dates in America/Bogota (UTC-5 all year), whatever the browser's time zone.
// Same conventions as the server: instants are ISO strings, days 'YYYY-MM-DD', times 'HH:mm'.

const OFFSET_MS = 5 * 60 * 60 * 1000;

export const WEEKDAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const WEEKDAYS_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const pad = (n) => String(n).padStart(2, '0');

export function localParts(instant) {
    const d = new Date(new Date(instant).getTime() - OFFSET_MS);
    const utcDay = d.getUTCDay();
    return {
        date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
        weekday: utcDay === 0 ? 7 : utcDay,
    };
}

export function toUtc(dateStr, timeStr = '00:00') {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh, mm) + OFFSET_MS);
}

export function today() {
    return localParts(new Date()).date;
}

export function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const r = new Date(Date.UTC(y, m - 1, d + days));
    return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}

export function weekdayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return day === 0 ? 7 : day;
}

export function mondayOf(dateStr) {
    return addDays(dateStr, 1 - weekdayOf(dateStr));
}

export function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

export function minutesToTime(total) {
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// "lunes 3 de noviembre"
export function formatDay(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${WEEKDAYS[weekdayOf(dateStr)].toLowerCase()} ${d} de ${MONTHS[m - 1]}`;
}

// "3 nov"
export function formatShortDay(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]}`;
}

// "lunes 3 de noviembre, 14:00"
export function formatDateTime(instant) {
    const { date, time } = localParts(instant);
    return `${formatDay(date)}, ${time}`;
}

// "2027-03" -> "marzo de 2027"
export function formatMonth(period) {
    const [y, m] = period.split('-').map(Number);
    return `${MONTHS[m - 1]} de ${y}`;
}

export function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
