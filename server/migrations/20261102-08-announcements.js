// Announcements ("anuncios") get an audience and an end date, and each reader's
// read mark. The academy now publishes too: teacherId holds whoever published it
// (teacher or academy). Existing announcements were for the teacher's students
// and stay visible for 15 days from their date.
const { DataTypes } = require('sequelize');

const ref = (model, allowNull = false) => ({
    type: DataTypes.UUID,
    allowNull,
    references: { model, key: 'id' },
});

const pad = (n) => String(n).padStart(2, '0');
const addDays = (dateStr, days) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

exports.up = async ({ context: queryInterface }) => {
    const columns = await queryInterface.describeTable('Announcements');
    if (!columns.audience) {
        // 'todos' | 'estudiantes' | 'profesores' (academy) or 'mis_estudiantes' (a teacher)
        await queryInterface.addColumn('Announcements', 'audience', { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'mis_estudiantes' });
    }
    if (!columns.visibleUntil) {
        await queryInterface.addColumn('Announcements', 'visibleUntil', { type: DataTypes.DATEONLY, allowNull: true });
    }

    const [rows] = await queryInterface.sequelize.query('SELECT id, date FROM Announcements WHERE visibleUntil IS NULL');
    for (const row of rows) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : new Date().toISOString().slice(0, 10);
        await queryInterface.sequelize.query('UPDATE Announcements SET visibleUntil = :until WHERE id = :id', {
            replacements: { until: addDays(date, 15), id: row.id },
        });
    }

    await queryInterface.createTable('AnnouncementReads', {
        id: { type: DataTypes.UUID, primaryKey: true },
        announcementId: ref('Announcements'),
        userId: ref('Users'),
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('AnnouncementReads', ['announcementId', 'userId'], { name: 'announcement_reads_unique', unique: true });
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable('AnnouncementReads');
    await queryInterface.removeColumn('Announcements', 'visibleUntil');
    await queryInterface.removeColumn('Announcements', 'audience');
};
