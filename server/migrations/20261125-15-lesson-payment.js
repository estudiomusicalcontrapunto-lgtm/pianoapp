// Single classes are charged first (the academy decides how many) and booked
// afterwards by the teacher: each lesson points to the charge it belongs to,
// so the app knows how many of a charge's classes are still to be booked.
// Existing single-class charges are linked to their lessons.
const { DataTypes } = require('sequelize');

exports.up = async ({ context: queryInterface }) => {
    const lessons = await queryInterface.describeTable('Lessons');
    if (!lessons.paymentId) {
        await queryInterface.addColumn('Lessons', 'paymentId', {
            type: DataTypes.UUID, allowNull: true, references: { model: 'Payments', key: 'id' },
        });
        await queryInterface.addIndex('Lessons', ['paymentId'], { name: 'lessons_payment' });
    }
    const [payments] = await queryInterface.sequelize.query(
        "SELECT id, lessonId, calculation FROM Payments WHERE type = 'clase_suelta'"
    );
    for (const payment of payments) {
        let calculation = payment.calculation;
        if (typeof calculation === 'string') {
            try { calculation = JSON.parse(calculation); } catch { calculation = null; }
        }
        const ids = [...new Set([...(calculation?.lessonIds || []), payment.lessonId].filter(Boolean))];
        for (const id of ids) {
            await queryInterface.sequelize.query('UPDATE Lessons SET paymentId = :paymentId WHERE id = :id', {
                replacements: { paymentId: payment.id, id },
            });
        }
    }
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.removeIndex('Lessons', 'lessons_payment');
    await queryInterface.removeColumn('Lessons', 'paymentId');
};
