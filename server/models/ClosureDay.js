const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Holidays and vacations. appliedAt is set once its lessons were moved to cancelada_por_academia.
const ClosureDay = sequelize.define('ClosureDay', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        unique: true
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: false
    },
    appliedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

module.exports = ClosureDay;
