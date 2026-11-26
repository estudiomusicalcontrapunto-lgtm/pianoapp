// Baseline: the tables that existed before migrations (created by sequelize.sync()).
// Existing databases already have them, so each one is created only if missing.
const { DataTypes } = require('sequelize');

const timestamps = {
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
};

const tableExists = async (queryInterface, name) => {
    const tables = await queryInterface.showAllTables();
    return tables.map(t => (typeof t === 'string' ? t : t.tableName)).includes(name);
};

exports.up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, 'Users'))) {
        await queryInterface.createTable('Users', {
            id: { type: DataTypes.UUID, primaryKey: true },
            email: { type: DataTypes.STRING, allowNull: false, unique: true },
            password: { type: DataTypes.STRING, allowNull: false },
            role: { type: DataTypes.ENUM('student', 'teacher', 'academy'), allowNull: false },
            name: { type: DataTypes.STRING, allowNull: false },
            classCode: { type: DataTypes.STRING, allowNull: true },
            teacherId: { type: DataTypes.UUID, allowNull: true, references: { model: 'Users', key: 'id' } },
            streak: { type: DataTypes.INTEGER, defaultValue: 0 },
            level: { type: DataTypes.STRING, defaultValue: '1' },
            xp: { type: DataTypes.INTEGER, defaultValue: 0 },
            lastPractice: { type: DataTypes.STRING, allowNull: true },
            ...timestamps,
        });
    }

    if (!(await tableExists(queryInterface, 'Repertoires'))) {
        await queryInterface.createTable('Repertoires', {
            id: { type: DataTypes.UUID, primaryKey: true },
            title: { type: DataTypes.STRING, allowNull: false },
            composer: { type: DataTypes.STRING, allowNull: false },
            measureCount: { type: DataTypes.INTEGER, defaultValue: 0 },
            currentMeasure: { type: DataTypes.INTEGER, defaultValue: 0 },
            progress: { type: DataTypes.INTEGER, defaultValue: 0 },
            status: { type: DataTypes.STRING, defaultValue: 'learning' },
            repetitions: { type: DataTypes.INTEGER, defaultValue: 0 },
            studentNotes: { type: DataTypes.TEXT },
            teacherNotes: { type: DataTypes.TEXT },
            riskMap: { type: DataTypes.JSON },
            pdfUrl: { type: DataTypes.STRING, allowNull: true },
            studentId: { type: DataTypes.UUID, allowNull: false, references: { model: 'Users', key: 'id' } },
            ...timestamps,
        });
    }

    if (!(await tableExists(queryInterface, 'Announcements'))) {
        await queryInterface.createTable('Announcements', {
            id: { type: DataTypes.UUID, primaryKey: true },
            title: { type: DataTypes.STRING, allowNull: false },
            content: { type: DataTypes.TEXT, allowNull: false },
            date: { type: DataTypes.STRING, allowNull: false },
            author: { type: DataTypes.STRING, allowNull: false },
            teacherId: { type: DataTypes.UUID, allowNull: false, references: { model: 'Users', key: 'id' } },
            ...timestamps,
        });
    }
};

exports.down = async () => {
    // The baseline is never reverted: it would drop pre-existing data.
};
