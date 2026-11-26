const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// One row per academy rule; value is JSON-encoded. See domain/settings.js for the keys.
const Setting = sequelize.define('Setting', {
    key: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    value: {
        type: DataTypes.TEXT,
        allowNull: false
    }
});

module.exports = Setting;
