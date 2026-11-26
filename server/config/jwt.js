// Secret that signs the login sessions (JWT). It must come from JWT_SECRET in .env:
// with a known or default key anyone could forge a session, even the academy's.
const PLACEHOLDERS = ['super_secret_key_change_me_in_production', 'secret_key'];
const MIN_LENGTH = 32;

/** Why JWT_SECRET is not usable, or null if it is. */
const jwtSecretProblem = (secret = process.env.JWT_SECRET) => {
    if (!secret) return 'Falta JWT_SECRET en server/.env.';
    if (PLACEHOLDERS.includes(secret)) return 'JWT_SECRET todavía tiene el valor de ejemplo. Cámbialo por uno propio.';
    if (secret.length < MIN_LENGTH) return `JWT_SECRET es muy corto: usa al menos ${MIN_LENGTH} caracteres al azar.`;
    return null;
};

const jwtSecret = () => {
    const problem = jwtSecretProblem();
    if (problem) throw new Error(problem);
    return process.env.JWT_SECRET;
};

module.exports = { jwtSecret, jwtSecretProblem };
