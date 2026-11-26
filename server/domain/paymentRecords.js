// Payments are records: what was charged, and how it was calculated, never
// changes. Only the review flow moves forward (status, reviewer, reason).
// A correction is a separate adjustment, so the history stays complete.
const { DomainError } = require('./errors');

// Fields the review flow may change on a registered payment
const PAYMENT_REVIEW_FIELDS = ['status', 'rejectionReason', 'reviewedById', 'reviewedAt', 'updatedAt'];

class PaymentLockedError extends DomainError {
    constructor(message = 'Un pago registrado no se puede modificar ni borrar. Para corregirlo, registra un ajuste.') {
        super('pago_inmutable', message, 409);
    }
}

const assertPaymentUpdateAllowed = (changedFields) => {
    const locked = changedFields.filter(f => !PAYMENT_REVIEW_FIELDS.includes(f));
    if (locked.length) throw new PaymentLockedError();
};

module.exports = { PAYMENT_REVIEW_FIELDS, PaymentLockedError, assertPaymentUpdateAllowed };
