// A pending make-up can close without being given: the student's runs out at
// the end of its month (perdida) and the teacher's at the end of the next month
// (descontada: a single class is discounted from the next payment). The lesson
// keeps its status; these columns say the make-up is no longer owed.
const { DataTypes } = require('sequelize');

const COLUMNS = {
    makeupClosedAt: { type: DataTypes.DATE, allowNull: true },
    makeupOutcome: { type: DataTypes.STRING(20), allowNull: true }, // 'perdida' | 'descontada'
};

exports.up = async ({ context: queryInterface }) => {
    const existing = await queryInterface.describeTable('Lessons');
    for (const [name, definition] of Object.entries(COLUMNS)) {
        if (!existing[name]) await queryInterface.addColumn('Lessons', name, definition);
    }
};

exports.down = async ({ context: queryInterface }) => {
    for (const name of Object.keys(COLUMNS).reverse()) {
        await queryInterface.removeColumn('Lessons', name);
    }
};
