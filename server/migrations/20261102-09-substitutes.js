// Teacher absences and substitutes ("reemplazos"). The academy records an
// absence and gives each lesson in it a substitute: another teacher of the
// academy (substituteTeacherId) or an outside one (name and phone, no account).
// The lesson keeps its own teacher, so the student stays with them.
// Also: lessons a teacher moved are flagged, so they do not count as cancellations.
const { DataTypes } = require('sequelize');

const ref = (model, allowNull = false) => ({
    type: DataTypes.UUID,
    allowNull,
    references: { model, key: 'id' },
});

const LESSON_COLUMNS = {
    substituteTeacherId: ref('Users', true),
    substituteName: { type: DataTypes.STRING, allowNull: true },
    substitutePhone: { type: DataTypes.STRING, allowNull: true },
    moved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
};

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('TeacherAbsences', {
        id: { type: DataTypes.UUID, primaryKey: true },
        teacherId: ref('Users'),
        startDate: { type: DataTypes.DATEONLY, allowNull: false },
        endDate: { type: DataTypes.DATEONLY, allowNull: false },
        reason: { type: DataTypes.STRING, allowNull: true },
        createdById: ref('Users', true),
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('TeacherAbsences', ['teacherId', 'startDate'], { name: 'teacher_absences_teacher' });

    const existing = await queryInterface.describeTable('Lessons');
    for (const [name, definition] of Object.entries(LESSON_COLUMNS)) {
        if (!existing[name]) await queryInterface.addColumn('Lessons', name, definition);
    }
    await queryInterface.addIndex('Lessons', ['substituteTeacherId', 'startsAt'], { name: 'lessons_substitute_start' });

    // moveLesson wrote this reason on the lessons it moved
    await queryInterface.sequelize.query(
        "UPDATE Lessons SET moved = 1 WHERE status = 'cancelada_por_profesor' AND reason = 'Movida a otro horario'"
    );
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.removeIndex('Lessons', 'lessons_substitute_start');
    for (const name of Object.keys(LESSON_COLUMNS).reverse()) {
        await queryInterface.removeColumn('Lessons', name);
    }
    await queryInterface.dropTable('TeacherAbsences');
};
