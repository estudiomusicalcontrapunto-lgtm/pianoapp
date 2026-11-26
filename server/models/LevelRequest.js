const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Level-up request ("solicitud de ascenso"). The student's level changes only
// when the academy approves it.
const LevelRequest = sequelize.define('LevelRequest', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    fromLevel: {
        type: DataTypes.STRING,
        allowNull: false
    },
    toLevel: {
        type: DataTypes.STRING,
        allowNull: false
    },
    modality: {
        type: DataTypes.ENUM('videos', 'muestra'),
        allowNull: false
    },
    pieces: {
        type: DataTypes.JSON, // [{ category: 'A' | 'B' | 'C', title, composer, videoUrl }]
        allowNull: false
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('pendiente', 'muestra_programada', 'aprobada', 'rechazada', 'cancelada'),
        defaultValue: 'pendiente'
    },
    showcaseAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    showcasePlace: {
        type: DataTypes.STRING,
        allowNull: true
    },
    decisionReason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    decidedById: {
        type: DataTypes.UUID,
        allowNull: true
    },
    decidedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

module.exports = LevelRequest;
