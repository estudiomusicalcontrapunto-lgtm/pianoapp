// Agenda labels: which class of the month each lesson is ("Clase 2 de 4"),
// single classes ("Clase suelta") and make-ups ("Reposición de la clase 2").
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase } = require('./helpers');
const { toUtc, addMinutes } = require('../domain/time');

describe('Etiquetas de clase en la agenda', () => {
    let models;
    const ids = {};

    before(async () => {
        models = await setupDatabase();
        const { User, Room } = models;
        ids.laura = (await User.create({ name: 'Laura', email: 'laura@test.co', role: 'teacher', password: 'clave-de-prueba-1' })).id;
        ids.sofia = (await User.create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', password: 'clave-de-prueba-1', teacherId: ids.laura })).id;
        ids.room = (await Room.create({ name: 'Salón 1' })).id;
    });

    after(teardownDatabase);

    const lesson = (date, extra = {}) => {
        const startsAt = toUtc(date, '16:00');
        return models.Lesson.create({
            studentId: ids.sofia, teacherId: ids.laura, roomId: ids.room,
            startsAt, endsAt: addMinutes(startsAt, 60), status: 'programada', kind: 'regular', ...extra,
        });
    };

    test('numera las clases del mes, la suelta y la reposición de una clase movida', async () => {
        const month = [];
        for (const date of ['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']) month.push(await lesson(date, { period: '2027-01' }));
        // Class 2 was moved: the original stays (moved) and a make-up replaces it
        await month[1].update({ status: 'reprogramada_por_estudiante', moved: true });
        const makeup = await lesson('2027-01-13', { period: '2027-01', kind: 'reposicion', originalLessonId: month[1].id });
        const { createPayment } = require('../services/paymentService');
        const pereira = await models.City.findOne({ where: { name: 'Pereira' } });
        const payment = await createPayment({
            studentId: ids.sofia, cityId: pereira.id, teacherId: ids.laura, type: 'clase_suelta', period: '2027-01',
            amount: 65000, dueDate: '2027-01-20', calculation: {},
        });
        const single = await lesson('2027-01-20', { period: '2027-01', paymentId: payment.id });

        const { classLabels } = require('../services/lessonLabels');
        // Only the week of the 11th is loaded, as in the agenda
        const week = [month[1], makeup, month[2], single].map(l => l.get({ plain: true }));
        const labels = await classLabels(week);
        assert.equal(labels.get(month[1].id), 'Clase 2 de 4');
        assert.equal(labels.get(makeup.id), 'Reposición de la clase 2');
        assert.equal(labels.get(month[2].id), 'Clase 3 de 4');
        assert.equal(labels.get(single.id), 'Clase suelta');
    });
});
