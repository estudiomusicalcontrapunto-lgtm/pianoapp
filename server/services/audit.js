const { AuditLog } = require('../models');

// Records a status change. Pass the caller's transaction so the entry
// is written only if the change itself commits.
const logAudit = ({ entityType, entityId, action, fromStatus = null, toStatus = null, actorId = null, details = null }, options = {}) =>
    AuditLog.create(
        { entityType, entityId: String(entityId), action, fromStatus, toStatus, actorId, details },
        { transaction: options.transaction }
    );

module.exports = { logAudit };
