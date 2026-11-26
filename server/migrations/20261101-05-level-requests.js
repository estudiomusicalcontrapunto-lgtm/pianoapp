// Level-up requests ("solicitudes de ascenso"): the teacher sends three pieces
// (categories A, B and C) as videos or asks for a showcase ("muestra"),
// and the academy approves before the student's level changes.
// Enum values are written out here (not imported) so this migration never changes.
const { DataTypes } = require('sequelize');

const ref = (model, allowNull = false) => ({
    type: DataTypes.UUID,
    allowNull,
    references: { model, key: 'id' },
});

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('LevelRequests', {
        id: { type: DataTypes.UUID, primaryKey: true },
        studentId: ref('Users'),
        teacherId: ref('Users'),
        fromLevel: { type: DataTypes.STRING, allowNull: false },
        toLevel: { type: DataTypes.STRING, allowNull: false },
        modality: { type: DataTypes.ENUM('videos', 'muestra'), allowNull: false },
        // [{ category: 'A' | 'B' | 'C', title, composer, videoUrl }]
        pieces: { type: DataTypes.JSON, allowNull: false },
        notes: { type: DataTypes.TEXT, allowNull: true },
        status: {
            type: DataTypes.ENUM('pendiente', 'muestra_programada', 'aprobada', 'rechazada', 'cancelada'),
            allowNull: false,
            defaultValue: 'pendiente',
        },
        showcaseAt: { type: DataTypes.DATE, allowNull: true },
        showcasePlace: { type: DataTypes.STRING, allowNull: true },
        decisionReason: { type: DataTypes.TEXT, allowNull: true },
        decidedById: ref('Users', true),
        decidedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('LevelRequests', ['studentId'], { name: 'level_requests_student' });
    await queryInterface.addIndex('LevelRequests', ['status'], { name: 'level_requests_status' });
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable('LevelRequests');
};
