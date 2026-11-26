const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A student's recurring weekly class; cycles generate their lessons from it
const FixedSchedule = sequelize.define('FixedSchedule', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    roomId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    weekday: {
        type: DataTypes.INTEGER, // 1 = lunes ... 6 = sábado
        allowNull: false
    },
    startTime: {
        type: DataTypes.STRING(5), // HH:mm, America/Bogota
        allowNull: false
    },
    durationMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 60
    },
    validFrom: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    validTo: {
        type: DataTypes.DATEONLY,
        allowNull: true
    }
});

module.exports = FixedSchedule;
