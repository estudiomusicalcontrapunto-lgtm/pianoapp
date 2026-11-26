// What a student pays. Only the academy sets prices, and they depend only on
// the student's city:
//   Mensualidad:  the city's monthly fee.
//   Clase suelta: the city's single-class fee; if empty, the monthly fee / 4.
// Teachers never set prices nor collect payments.
//   Payment text: always the city's (the academy collects every payment).
//
// The amounts are copied into each payment when it is created: a later price
// change applies from the next charge on, never to charges already made.

const CLASSES_PER_MONTH = 4;

const hasValue = (value) => value !== null && value !== undefined && value !== '';

/**
 * city: { monthlyFee, singleClassFee? }.
 * Returns { monthlyFee, singleClassFee, singleSource } where singleSource is
 * 'ciudad' (set explicitly) or 'mensualidad' (monthly fee / 4).
 */
const resolvePrices = ({ city }) => {
    if (!city || !hasValue(city.monthlyFee)) throw new Error('La ciudad no tiene mensualidad configurada.');
    const monthlyFee = Number(city.monthlyFee);
    if (hasValue(city.singleClassFee)) {
        return { monthlyFee, singleClassFee: Number(city.singleClassFee), singleSource: 'ciudad' };
    }
    return { monthlyFee, singleClassFee: Math.round(monthlyFee / CLASSES_PER_MONTH), singleSource: 'mensualidad' };
};

const resolvePaymentText = ({ city }) => ({ text: city?.paymentText || '', source: 'ciudad' });

const MAX_FEE = 100000000;

// Validates a fee typed by the academy. Empty is allowed when optional.
const parseFee = (value, label, { optional = false } = {}) => {
    if (!hasValue(value)) {
        if (optional) return { value: null };
        return { error: `${label} es obligatoria.` };
    }
    const number = typeof value === 'string' ? Number(value.replace(/[.\s$]/g, '')) : value;
    if (!Number.isInteger(number) || number <= 0 || number > MAX_FEE) {
        return { error: `${label} debe ser un valor en pesos, sin decimales, mayor que 0.` };
    }
    return { value: number };
};

module.exports = { CLASSES_PER_MONTH, resolvePrices, resolvePaymentText, parseFee };
