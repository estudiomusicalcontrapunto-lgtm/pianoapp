const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Days a teacher will not give classes (local dates, both inclusive).
// Their lessons in that range get a substitute or are cancelled.
const TeacherAbsence = sequelize.define('TeacherAbsence', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    teacherId: {
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
    reason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    createdById: {
        type: DataTypes.UUID,
        allowNull: true
    }
});

module.exports = TeacherAbsence;
