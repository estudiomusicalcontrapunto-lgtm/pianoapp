// What happens to a student's charges when the academy archives or deletes them.
//
// - Archiving annuls the charges still waiting for payment (por pagar or with
//   the receipt rejected): the student is gone, so nobody chases them. A debt
//   (classes already taken and not paid) stays: if the student comes back, they
//   pay it before getting a new time.
// - An archived student can be deleted, payments included, unless:
//   * a receipt is still under review (the academy approves or rejects it first), or
//   * a paid month has not ended yet: classes owed of that month still count
//     until it is over, so the student can be deleted from the 1st of the next month.
const { addMonths, formatMonth, monthOf } = require('./time');
const { PAYMENT_STATUS } = require('./billing');

const OPEN_STATUSES = [PAYMENT_STATUS.POR_PAGAR, PAYMENT_STATUS.RECHAZADO];

/** Charges that archiving annuls (debts stay). */
const chargesToAnnul = (payments) =>
    payments.filter(p => OPEN_STATUSES.includes(p.status) && !p.calculation?.debt);

/**
 * Why an archived student cannot be deleted yet, or null if they can.
 * payments: the student's payments; today: 'YYYY-MM-DD' in Bogotá.
 * Returns { code, message }.
 */
const deletionBlocker = (payments, today) => {
    if (payments.some(p => p.status === PAYMENT_STATUS.EN_REVISION)) {
        return {
            code: 'comprobante_por_revisar',
            message: 'Este estudiante tiene un comprobante por revisar. Apruébalo o recházalo en Pagos y después podrás eliminarlo.',
        };
    }
    const thisMonth = monthOf(today);
    const lastPaid = payments
        .filter(p => p.status === PAYMENT_STATUS.APROBADO && p.period >= thisMonth)
        .map(p => p.period)
        .sort()
        .pop();
    if (lastPaid) {
        return {
            code: 'mes_pagado_vigente',
            message: `Este estudiante pagó ${formatMonth(lastPaid)} y ese mes no ha terminado. `
                + `Podrás eliminarlo desde el 1 de ${formatMonth(addMonths(lastPaid, 1))}.`,
        };
    }
    return null;
};

module.exports = { chargesToAnnul, deletionBlocker };
