const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Repertoire = sequelize.define('Repertoire', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    composer: {
        type: DataTypes.STRING,
        allowNull: false
    },
    measureCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    currentMeasure: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    progress: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'learning'
    },
    repetitions: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    studentNotes: {
        type: DataTypes.TEXT,
        defaultValue: ""
    },
    teacherNotes: {
        type: DataTypes.TEXT,
        defaultValue: ""
    },
    riskMap: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    pdfUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    }
});

module.exports = Repertoire;
