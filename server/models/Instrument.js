const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// An instrument the academy teaches. Inactive ones are kept for history.
const Instrument = sequelize.define('Instrument', {
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
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
});

module.exports = Instrument;
