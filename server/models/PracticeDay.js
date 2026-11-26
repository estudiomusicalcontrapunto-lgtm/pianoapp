const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A day the student marked as practiced (local date, America/Bogota)
const PracticeDay = sequelize.define('PracticeDay', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    }
});

module.exports = PracticeDay;
