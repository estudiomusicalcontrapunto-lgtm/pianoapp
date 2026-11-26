const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A notice ("aviso") sent by the system or written by a person, with its recipients
const Notice = sequelize.define('Notice', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    kind: {
        type: DataTypes.ENUM('sistema', 'manual'),
        allowNull: false
    },
    category: {
        type: DataTypes.STRING, // e.g. clase_cancelada, recordatorio_pago
        allowNull: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    authorId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    meta: {
        type: DataTypes.JSON,
        allowNull: true
    }
});

const NoticeRecipient = sequelize.define('NoticeRecipient', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    noticeId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    readAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

module.exports = { Notice, NoticeRecipient };
