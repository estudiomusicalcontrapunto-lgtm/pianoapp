const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Many-to-many: the instruments a teacher teaches
const TeacherInstrument = sequelize.define('TeacherInstrument', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    instrumentId: {
        type: DataTypes.UUID,
        allowNull: false
    }
});

module.exports = TeacherInstrument;
