const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A city where the academy has a branch ("sede"). Students, teachers and rooms belong to one.
const City = sequelize.define('City', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    monthlyFee: {
        type: DataTypes.INTEGER, // COP, whole pesos
        allowNull: false
    },
    // Empty = monthlyFee / 4 (see domain/pricing.js)
    singleClassFee: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    // Bank account, Nequi and instructions shown on the payment screen
    paymentText: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
});

module.exports = City;
