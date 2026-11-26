const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A teacher's weekly window in a room, for regular classes or for make-ups
const Availability = sequelize.define('Availability', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
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
    endTime: {
        type: DataTypes.STRING(5),
        allowNull: false
    },
    type: {
        type: DataTypes.ENUM('clase', 'reposicion'),
        allowNull: false
    },
    capacity: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
});

module.exports = Availability;
