const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { PaymentLockedError } = require('../domain/paymentRecords');

// A receipt uploaded for a payment. A payment has one receipt under review at
// a time; rejected ones stay as history, so receipts are never deleted.
const PaymentReceipt = sequelize.define('PaymentReceipt', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    paymentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    path: {
        type: DataTypes.STRING,
        allowNull: false
    },
    originalName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    mimeType: {
        type: DataTypes.STRING,
        allowNull: true
    },
    uploadedById: {
        type: DataTypes.UUID,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('en_revision', 'aprobado', 'rechazado'),
        defaultValue: 'en_revision'
    },
    rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    reviewedById: {
        type: DataTypes.UUID,
        allowNull: true
    },
    reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    hooks: {
        beforeDestroy: () => { throw new PaymentLockedError('Un comprobante enviado no se puede borrar.'); },
        beforeBulkDestroy: () => { throw new PaymentLockedError('Un comprobante enviado no se puede borrar.'); },
    }
});

module.exports = PaymentReceipt;
