// Monthly billing: a lesson belongs to a month ("period", 'YYYY-MM') instead of
// a 4-week cycle. cycleId becomes optional (cycles stay as history).
const { DataTypes } = require('sequelize');

const sqliteIndexes = async (queryInterface, table) => {
    const [rows] = await queryInterface.sequelize.query(
        `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql IS NOT NULL`
    );
    return rows;
};

// SQLite rebuilds the table to change a column: its indexes are kept aside and
// put back, and foreign keys are off meanwhile so the rows pointing to it stay.
const changeColumnSafely = async (queryInterface, table, column, definition) => {
    if (queryInterface.sequelize.getDialect() !== 'sqlite') {
        await queryInterface.changeColumn(table, column, definition);
        return;
    }
    const indexes = await sqliteIndexes(queryInterface, table);
    await queryInterface.sequelize.query('PRAGMA foreign_keys = OFF');
    try {
        await queryInterface.changeColumn(table, column, definition);
        const after = new Set((await sqliteIndexes(queryInterface, table)).map(i => i.name));
        for (const index of indexes) {
            if (!after.has(index.name)) await queryInterface.sequelize.query(index.sql);
        }
    } finally {
        await queryInterface.sequelize.query('PRAGMA foreign_keys = ON');
    }
};

exports.up = async ({ context: queryInterface }) => {
    const lessons = await queryInterface.describeTable('Lessons');
    if (!lessons.period) {
        await queryInterface.addColumn('Lessons', 'period', { type: DataTypes.STRING(7), allowNull: true });
    }
    await changeColumnSafely(queryInterface, 'Lessons', 'cycleId', {
        type: DataTypes.UUID, allowNull: true, references: { model: 'Cycles', key: 'id' },
    });
    await queryInterface.addIndex('Lessons', ['studentId', 'period'], { name: 'lessons_student_period' });
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.removeIndex('Lessons', 'lessons_student_period');
    await queryInterface.removeColumn('Lessons', 'period');
};
