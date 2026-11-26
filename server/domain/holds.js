// Weekly slots held after a free assessment. A hold lasts horas_cupo_apartado
// hours; if no payment is registered by then, the slot is free again.
const { HOLD_STATUS } = require('./constants');
const { addHours } = require('./time');

const computeHoldExpiry = (heldAt, settings) => addHours(heldAt, settings.horas_cupo_apartado);

// Expiry is checked against `now`, so an expired hold stops blocking the
// slot even before the scheduled job marks it as liberado.
const isHoldActive = (assessment, now) =>
    assessment.holdStatus === HOLD_STATUS.APARTADO &&
    !!assessment.holdExpiresAt &&
    new Date(now) < new Date(assessment.holdExpiresAt);

const isHoldExpired = (assessment, now) =>
    assessment.holdStatus === HOLD_STATUS.APARTADO && !isHoldActive(assessment, now);

module.exports = { computeHoldExpiry, isHoldActive, isHoldExpired };
