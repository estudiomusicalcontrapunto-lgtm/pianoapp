const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Many-to-many: a teacher can use several rooms and a room can be shared
const TeacherRoom = sequelize.define('TeacherRoom', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    roomId: {
        type: DataTypes.UUID,
        allowNull: false
    }
});

module.exports = TeacherRoom;
