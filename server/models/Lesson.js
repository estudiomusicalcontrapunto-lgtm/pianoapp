const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Lesson = sequelize.define('Lesson', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    // 4-week cycle (old billing); empty for lessons of the monthly billing
    cycleId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    // Month the lesson belongs to ('YYYY-MM'), monthly billing
    period: {
        type: DataTypes.STRING(7),
        allowNull: true
    },
    // The single-class charge this lesson belongs to (the teacher books them after the academy charges them)
    paymentId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    studentId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    roomId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    startsAt: {
        type: DataTypes.DATE, // UTC
        allowNull: false
    },
    endsAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM(
            'programada',
            'tomada',
            'perdida',
            'reprogramada_por_estudiante',
            'cancelada_por_profesor',
            'cancelada_por_academia'
        ),
        defaultValue: 'programada'
    },
    kind: {
        type: DataTypes.ENUM('regular', 'reposicion'),
        defaultValue: 'regular'
    },
    // Set on make-ups: the lesson this one replaces
    originalLessonId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    // Make-up window used, when booked in one
    availabilityId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    changedById: {
        type: DataTypes.UUID,
        allowNull: true
    },
    changedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    // Substitute who gives this lesson while teacherId is absent: a teacher of
    // the academy, or an outside one known only by name and phone
    substituteTeacherId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    substituteName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    substitutePhone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // The teacher moved it to another time (its make-up is the new lesson):
    // cancelled by status, but not a cancellation
    moved: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // A make-up that was owed and ran out of time: no longer pending
    makeupClosedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    makeupOutcome: {
        type: DataTypes.STRING(20), // 'perdida' | 'descontada'
        allowNull: true
    }
});

module.exports = Lesson;
