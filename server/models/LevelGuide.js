const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// The academy's text describing what a level asks for, for one instrument
const LevelRequirement = sequelize.define('LevelRequirement', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    instrumentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    level: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    updatedById: {
        type: DataTypes.UUID,
        allowNull: true
    }
});

// A PDF or a link attached to a level of an instrument
const LevelResource = sequelize.define('LevelResource', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    instrumentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    level: {
        type: DataTypes.STRING,
        allowNull: false
    },
    kind: {
        type: DataTypes.ENUM('pdf', 'enlace'),
        allowNull: false
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    url: {
        type: DataTypes.STRING(2048),
        allowNull: true
    },
    filePath: {
        type: DataTypes.STRING,
        allowNull: true
    },
    fileName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    fileSize: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    createdById: {
        type: DataTypes.UUID,
        allowNull: true
    }
});

// The stored path never leaves the server
LevelResource.prototype.toJSON = function () {
    const values = Object.assign({}, this.get());
    delete values.filePath;
    return values;
};

module.exports = { LevelRequirement, LevelResource };
