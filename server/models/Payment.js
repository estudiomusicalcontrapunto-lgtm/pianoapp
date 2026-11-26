const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { PaymentLockedError, assertPaymentUpdateAllowed } = require('../domain/paymentRecords');

/**
 * A charge to a student: mensualidad, proporcional (first month of a new
 * student) or clase suelta. Once registered it is never edited or deleted:
 * only its review status moves on, and a correction is a PaymentAdjustment.
 */
const Payment = sequelize.define('Payment', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    cityId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    type: {
        type: DataTypes.ENUM('mensualidad', 'proporcional', 'clase_suelta'),
        allowNull: false
    },
    period: {
        type: DataTypes.STRING(7), // YYYY-MM
        allowNull: true
    },
    lessonId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    amount: {
        type: DataTypes.INTEGER, // COP, whole pesos
        allowNull: false
    },
    calculation: {
        type: DataTypes.JSON,
        allowNull: true
    },
    dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('por_pagar', 'en_revision', 'aprobado', 'rechazado', 'anulado'),
        defaultValue: 'por_pagar'
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
    },
    createdById: {
        type: DataTypes.UUID,
        allowNull: true
    }
}, {
    hooks: {
        beforeUpdate: (payment) => assertPaymentUpdateAllowed(payment.changed() || []),
        beforeBulkUpdate: (options) => assertPaymentUpdateAllowed(options.fields || Object.keys(options.attributes || {})),
        beforeDestroy: () => { throw new PaymentLockedError(); },
        beforeBulkDestroy: () => { throw new PaymentLockedError(); },
    }
});

module.exports = Payment;
