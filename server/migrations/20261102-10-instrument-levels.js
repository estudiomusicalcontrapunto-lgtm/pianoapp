// Each instrument has its own ladder of levels, lowest first. Existing
// instruments get the ladder every instrument used until now, so no
// student, requirement or level-up request changes.
const crypto = require('crypto');
const { DataTypes } = require('sequelize');

// Written out (not imported) so this migration never changes
const STANDARD_LEVELS = ['Inicial', '1', '2', '3', '4', '5', '6', '7', '8', 'Prodigy', 'Legend', 'Genius'];

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('InstrumentLevels', {
        id: { type: DataTypes.UUID, primaryKey: true },
        instrumentId: { type: DataTypes.UUID, allowNull: false, references: { model: 'Instruments', key: 'id' } },
        name: { type: DataTypes.STRING(40), allowNull: false },
        position: { type: DataTypes.INTEGER, allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('InstrumentLevels', ['instrumentId', 'name'], { name: 'instrument_levels_unique', unique: true });

    const [instruments] = await queryInterface.sequelize.query('SELECT id FROM Instruments');
    const now = new Date();
    const rows = instruments.flatMap(instrument => STANDARD_LEVELS.map((name, position) => ({
        id: crypto.randomUUID(), instrumentId: instrument.id, name, position, createdAt: now, updatedAt: now,
    })));
    if (rows.length) await queryInterface.bulkInsert('InstrumentLevels', rows);
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable('InstrumentLevels');
};
