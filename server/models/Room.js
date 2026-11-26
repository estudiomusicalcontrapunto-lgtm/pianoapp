const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Room = sequelize.define('Room', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    // Unique within its city
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    cityId: {
        type: DataTypes.UUID,
        allowNull: true
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

module.exports = Room;
