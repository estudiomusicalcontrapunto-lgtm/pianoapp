// A business-rule failure with a message meant for the user (in Spanish).
// status is the HTTP code routes should answer with.
class DomainError extends Error {
    constructor(code, message, status = 400, details = undefined) {
        super(message);
        this.name = 'DomainError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (code, message, status = 400, details = undefined) => ({ ok: false, code, message, status, details });

// Turns a failed check into a thrown DomainError
const assertOk = (result) => {
    if (!result.ok) throw new DomainError(result.code, result.message, result.status, result.details);
    return result;
};

module.exports = { DomainError, ok, fail, assertOk };
