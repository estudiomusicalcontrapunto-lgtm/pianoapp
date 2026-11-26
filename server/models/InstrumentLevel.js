const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// One level of an instrument's ladder; position 0 is the lowest.
// Students, requirements and level-up requests refer to it by name.
const InstrumentLevel = sequelize.define('InstrumentLevel', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    instrumentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING(40),
        allowNull: false
    },
    position: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
});

module.exports = InstrumentLevel;
