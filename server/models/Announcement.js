const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A message a person publishes ("anuncio"). It shows in the readers' notices
// until visibleUntil (inclusive, America/Bogota) and then only in the history.
const Announcement = sequelize.define('Announcement', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    date: {
        type: DataTypes.STRING, // YYYY-MM-DD it was published
        allowNull: false
    },
    author: {
        type: DataTypes.STRING, // Author's name when it was published
        allowNull: false
    },
    // Who published it: a teacher or the academy (the column name predates academy announcements)
    teacherId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    // 'todos' | 'estudiantes' | 'profesores' (academy) or 'mis_estudiantes' (the author's students)
    audience: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'mis_estudiantes'
    },
    visibleUntil: {
        type: DataTypes.DATEONLY,
        allowNull: true
    }
});

// One reader marked the announcement as read
const AnnouncementRead = sequelize.define('AnnouncementRead', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    announcementId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false
    }
});

module.exports = { Announcement, AnnouncementRead };
