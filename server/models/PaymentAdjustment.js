const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { PaymentLockedError } = require('../domain/paymentRecords');

const locked = () => { throw new PaymentLockedError('Un ajuste registrado no se puede modificar ni borrar. Registra otro ajuste.'); };

/**
 * A correction to what a student owes, kept apart from the payment it corrects:
 * - correccion: the academy fixes an amount (with a reason);
 * - descuento_clase_no_repuesta: a class the teacher cancelled and could not
 *   make up in time, discounted from the next payment.
 * amount is signed COP: negative lowers what the student owes. Never edited or deleted.
 */
const PaymentAdjustment = sequelize.define('PaymentAdjustment', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    paymentId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    appliedPaymentId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    lessonId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    kind: {
        type: DataTypes.ENUM('correccion', 'descuento_clase_no_repuesta'),
        allowNull: false
    },
    amount: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    createdById: {
        type: DataTypes.UUID,
        allowNull: true
    }
}, {
    updatedAt: false,
    hooks: {
        // A pending discount is linked to the payment it lands on; nothing else changes
        beforeUpdate: (adjustment) => {
            const changed = adjustment.changed() || [];
            if (changed.some(f => f !== 'appliedPaymentId') || adjustment.previous('appliedPaymentId')) locked();
        },
        beforeBulkUpdate: (options) => {
            const fields = options.fields || Object.keys(options.attributes || {});
            if (fields.some(f => f !== 'appliedPaymentId')) locked();
        },
        beforeDestroy: locked,
        beforeBulkDestroy: locked,
    }
});

module.exports = PaymentAdjustment;
