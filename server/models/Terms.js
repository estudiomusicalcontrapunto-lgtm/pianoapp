const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { DomainError } = require('../domain/errors');

const locked = () => { throw new DomainError('terminos_inmutables', 'Una versión publicada de los términos no se puede cambiar. Publica una nueva versión.', 409); };

// A published version of the terms and conditions. Editing the text publishes a new version.
const TermsVersion = sequelize.define('TermsVersion', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    // Students who already use the app must accept it by this day
    acceptBy: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    publishedById: {
        type: DataTypes.UUID,
        allowNull: true
    }
}, {
    updatedAt: false,
    hooks: { beforeUpdate: locked, beforeBulkUpdate: locked, beforeDestroy: locked, beforeBulkDestroy: locked },
});

// Who accepted which version, and when
const TermsAcceptance = sequelize.define('TermsAcceptance', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    termsVersionId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    version: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    acceptedAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    ipAddress: {
        type: DataTypes.STRING,
        allowNull: true
    },
    userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true
    }
}, {
    timestamps: false,
});

module.exports = { TermsVersion, TermsAcceptance };
