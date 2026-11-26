const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Free assessment ("valoración"). The hold* fields describe the weekly slot
// set aside for the prospect until holdExpiresAt, unless the payment arrives first.
const Assessment = sequelize.define('Assessment', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    studentName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    studentBirthDate: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    contactName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    contactPhone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    contactEmail: {
        type: DataTypes.STRING,
        allowNull: true
    },
    scheduledAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('agendada', 'realizada', 'convertida', 'descartada'),
        defaultValue: 'agendada'
    },
    result: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    holdRoomId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    holdWeekday: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    holdStartTime: {
        type: DataTypes.STRING(5),
        allowNull: true
    },
    holdDurationMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    holdExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    holdStatus: {
        type: DataTypes.ENUM('sin_apartar', 'apartado', 'liberado', 'convertido'),
        defaultValue: 'sin_apartar'
    },
    convertedStudentId: {
        type: DataTypes.UUID,
        allowNull: true
    }
});

module.exports = Assessment;
