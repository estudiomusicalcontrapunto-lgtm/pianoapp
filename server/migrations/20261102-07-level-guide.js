// What each level asks for, per instrument ("grados"): a text written by the
// academy plus attached PDFs and links. Teachers and students read it.
const { DataTypes } = require('sequelize');

const ref = (model, allowNull = false) => ({
    type: DataTypes.UUID,
    allowNull,
    references: { model, key: 'id' },
});

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('LevelRequirements', {
        id: { type: DataTypes.UUID, primaryKey: true },
        instrumentId: ref('Instruments'),
        level: { type: DataTypes.STRING, allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: false },
        updatedById: ref('Users', true),
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('LevelRequirements', ['instrumentId', 'level'], { name: 'level_requirements_unique', unique: true });

    await queryInterface.createTable('LevelResources', {
        id: { type: DataTypes.UUID, primaryKey: true },
        instrumentId: ref('Instruments'),
        level: { type: DataTypes.STRING, allowNull: false },
        kind: { type: DataTypes.ENUM('pdf', 'enlace'), allowNull: false },
        title: { type: DataTypes.STRING, allowNull: false },
        url: { type: DataTypes.STRING(2048), allowNull: true },
        // Relative to UPLOADS_DIR, outside any public folder
        filePath: { type: DataTypes.STRING, allowNull: true },
        fileName: { type: DataTypes.STRING, allowNull: true },
        fileSize: { type: DataTypes.INTEGER, allowNull: true },
        createdById: ref('Users', true),
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('LevelResources', ['instrumentId', 'level'], { name: 'level_resources_level' });
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable('LevelResources');
    await queryInterface.dropTable('LevelRequirements');
};
