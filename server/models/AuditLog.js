const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Append-only record of status changes on lessons, cycles, holds and settings
const AuditLog = sequelize.define('AuditLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    entityType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    entityId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    action: {
        type: DataTypes.STRING,
        allowNull: false
    },
    fromStatus: {
        type: DataTypes.STRING,
        allowNull: true
    },
    toStatus: {
        type: DataTypes.STRING,
        allowNull: true
    },
    actorId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    details: {
        type: DataTypes.JSON,
        allowNull: true
    }
}, {
    updatedAt: false
});

module.exports = AuditLog;
