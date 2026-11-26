// The days a student practiced (local dates in America/Bogota), so the week
// can show them and the streak counts consecutive days. Until now only the last
// day was kept: it becomes the first entry, and the stored streak is reset to
// what that single day proves (1 if it was today or yesterday, otherwise 0).
const crypto = require('crypto');
const { DataTypes } = require('sequelize');

const OFFSET_MS = 5 * 60 * 60 * 1000;
const localDay = (date) => new Date(date.getTime() - OFFSET_MS).toISOString().slice(0, 10);

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('PracticeDays', {
        id: { type: DataTypes.UUID, primaryKey: true },
        studentId: { type: DataTypes.UUID, allowNull: false, references: { model: 'Users', key: 'id' } },
        date: { type: DataTypes.DATEONLY, allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('PracticeDays', ['studentId', 'date'], { name: 'practice_days_unique', unique: true });

    const [students] = await queryInterface.sequelize.query(
        "SELECT id, lastPractice FROM Users WHERE role = 'student' AND lastPractice IS NOT NULL"
    );
    const now = new Date();
    if (students.length) {
        await queryInterface.bulkInsert('PracticeDays', students.map(s => ({
            id: crypto.randomUUID(), studentId: s.id, date: s.lastPractice, createdAt: now, updatedAt: now,
        })));
    }
    const today = localDay(now);
    const yesterday = localDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    await queryInterface.sequelize.query(
        "UPDATE Users SET streak = CASE WHEN lastPractice IN (:today, :yesterday) THEN 1 ELSE 0 END WHERE role = 'student'",
        { replacements: { today, yesterday } }
    );
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable('PracticeDays');
};
