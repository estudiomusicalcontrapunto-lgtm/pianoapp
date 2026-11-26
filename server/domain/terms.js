// Terms and conditions (students only).
// - A new student (account created after the version was published) cannot use
//   the app until they accept it.
// - A student who was already using the app may postpone it until the
//   version's acceptBy day (e.g. 2026-12-31); meanwhile they cannot book or
//   change classes. From the next day on, they cannot use the app until they accept.
// - When the academy publishes a new version without acceptBy, students who had
//   accepted an earlier one can keep using the app but cannot book until they accept.
const { formatDay } = require('./time');

/**
 * version: { id, version, acceptBy?, createdAt } or null (nothing published yet)
 * acceptance: the student's latest { termsVersionId, acceptedAt } or null
 * accountCreatedAt: when the student's account was created; today: 'YYYY-MM-DD'
 */
const termsStatus = ({ version, acceptance, accountCreatedAt, today }) => {
    if (!version) return { required: false };
    if (acceptance && acceptance.termsVersionId === version.id) {
        return { required: false, accepted: true, acceptedAt: acceptance.acceptedAt, version: version.version };
    }
    const newAccount = !acceptance && new Date(accountCreatedAt) >= new Date(version.createdAt);
    let canPostpone = false;
    if (!newAccount) {
        if (version.acceptBy) canPostpone = today <= version.acceptBy;
        else canPostpone = !!acceptance; // accepted an earlier version
    }
    let message;
    if (canPostpone) {
        message = version.acceptBy
            ? `La academia actualizó los términos y condiciones. Acéptalos a más tardar el ${formatDay(version.acceptBy)}. Mientras no los aceptes, no puedes cambiar ni agendar clases.`
            : 'La academia actualizó los términos y condiciones. Mientras no los aceptes, no puedes cambiar ni agendar clases.';
    } else if (!newAccount && version.acceptBy) {
        message = `El plazo para aceptar los términos y condiciones venció el ${formatDay(version.acceptBy)}. Acéptalos para seguir usando la app.`;
    } else {
        message = 'Antes de empezar, lee y acepta los términos y condiciones de la academia.';
    }
    return {
        required: true,
        blocking: !canPostpone,
        canPostpone,
        schedulingBlocked: true,
        deadline: version.acceptBy || null,
        version: version.version,
        message,
    };
};

module.exports = { termsStatus };
