const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A paid period ("mensualidad"). Its lessons are generated only once the payment is confirmed.
const Cycle = sequelize.define('Cycle', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    plan: {
        type: DataTypes.ENUM('paquete_4', 'suelta'),
        allowNull: false
    },
    classesIncluded: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    amount: {
        type: DataTypes.INTEGER, // COP, whole pesos
        allowNull: false
    },
    paymentStatus: {
        type: DataTypes.ENUM('pendiente', 'en_revision', 'pagado', 'vencido'),
        defaultValue: 'pendiente'
    },
    status: {
        type: DataTypes.ENUM('pendiente_pago', 'activo', 'finalizado', 'cancelado'),
        defaultValue: 'pendiente_pago'
    },
    receiptPath: {
        type: DataTypes.STRING,
        allowNull: true
    },
    receiptUploadedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    confirmedById: {
        type: DataTypes.UUID,
        allowNull: true
    },
    confirmedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true
    }
});

module.exports = Cycle;
