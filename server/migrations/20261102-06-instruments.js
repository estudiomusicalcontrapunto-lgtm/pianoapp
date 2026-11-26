// Instruments: the academy keeps a catalog; each student studies one instrument
// and each teacher teaches one or more. Existing students and teachers start with Piano.
const crypto = require('crypto');
const { DataTypes } = require('sequelize');

const ref = (model, allowNull = false) => ({
    type: DataTypes.UUID,
    allowNull,
    references: { model, key: 'id' },
});

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('Instruments', {
        id: { type: DataTypes.UUID, primaryKey: true },
        name: { type: DataTypes.STRING, allowNull: false, unique: true },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.createTable('TeacherInstruments', {
        id: { type: DataTypes.UUID, primaryKey: true },
        teacherId: ref('Users'),
        instrumentId: ref('Instruments'),
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('TeacherInstruments', ['teacherId', 'instrumentId'], { name: 'teacher_instruments_unique', unique: true });

    const users = await queryInterface.describeTable('Users');
    if (!users.instrumentId) {
        await queryInterface.addColumn('Users', 'instrumentId', ref('Instruments', true));
    }

    const now = new Date();
    const pianoId = crypto.randomUUID();
    await queryInterface.bulkInsert('Instruments', [{ id: pianoId, name: 'Piano', active: true, createdAt: now, updatedAt: now }]);
    await queryInterface.sequelize.query(
        "UPDATE Users SET instrumentId = :pianoId WHERE role = 'student' AND instrumentId IS NULL",
        { replacements: { pianoId } }
    );
    const [teachers] = await queryInterface.sequelize.query("SELECT id FROM Users WHERE role = 'teacher'");
    if (teachers.length) {
        await queryInterface.bulkInsert('TeacherInstruments', teachers.map(t => ({
            id: crypto.randomUUID(), teacherId: t.id, instrumentId: pianoId, createdAt: now, updatedAt: now,
        })));
    }
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.removeColumn('Users', 'instrumentId');
    await queryInterface.dropTable('TeacherInstruments');
    await queryInterface.dropTable('Instruments');
};
