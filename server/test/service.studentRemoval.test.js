// Archiving and deleting a student who has payments:
// - archiving annuls the charges still waiting for payment (a debt stays) and tells the teacher;
// - an archived student with pending or annulled charges can be deleted;
// - a receipt under review, or a paid month that has not ended, holds the deletion.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase } = require('./helpers');
const { deletionBlocker, chargesToAnnul } = require('../domain/studentRemoval');
const { toUtc } = require('../domain/time');

describe('retirar a un estudiante con pagos', () => {
    let models;
    let lifecycle;
    const people = {};
    let room;

    const charge = (student, fields) => models.Payment.create({
        studentId: student.id, cityId: people.cityId, type: 'mensualidad', amount: 260000, dueDate: `${fields.period}-05`, ...fields,
    });
    const newStudent = (name) => models.User.create({
        name, email: `${name.toLowerCase()}@t.co`, password: 'x-clave-123', role: 'student', cityId: people.cityId, teacherId: people.laura.id,
    });

    before(async () => {
        models = await setupDatabase();
        lifecycle = require('../services/studentLifecycleService');
        const pereira = await models.City.findOne({ where: { name: 'Pereira' } });
        people.cityId = pereira.id;
        people.academy = await models.User.create({ name: 'Academia', email: 'academia@t.co', password: 'x-clave-123', role: 'academy' });
        people.laura = await models.User.create({ name: 'Laura', email: 'laura@t.co', password: 'x-clave-123', role: 'teacher', cityId: pereira.id });
        room = await models.Room.create({ name: 'Salón Principal', cityId: pereira.id });
    });

    after(teardownDatabase);

    test('reglas: pendiente o anulado no frena; comprobante en revisión o mes pagado sin terminar sí', () => {
        const today = '2026-12-10';
        assert.equal(deletionBlocker([{ status: 'por_pagar', period: '2026-12' }, { status: 'anulado', period: '2026-12' }], today), null);
        assert.equal(deletionBlocker([{ status: 'aprobado', period: '2026-11' }], today), null);
        assert.equal(deletionBlocker([{ status: 'en_revision', period: '2026-12' }], today).code, 'comprobante_por_revisar');
        const paid = deletionBlocker([{ status: 'aprobado', period: '2026-12' }, { status: 'aprobado', period: '2027-01' }], today);
        assert.equal(paid.code, 'mes_pagado_vigente');
        assert.match(paid.message, /pagó enero de 2027.*desde el 1 de febrero de 2027/);
        // A debt is not annulled
        assert.deepEqual(
            chargesToAnnul([
                { id: 1, status: 'por_pagar' }, { id: 2, status: 'rechazado' }, { id: 3, status: 'aprobado' },
                { id: 4, status: 'en_revision' }, { id: 5, status: 'por_pagar', calculation: { debt: true } },
            ]).map(p => p.id),
            [1, 2]
        );
    });

    test('archivar anula los cobros sin pagar, deja la deuda y avisa al profesor que su horario quedó libre', async () => {
        const juan = await newStudent('Juan');
        await models.FixedSchedule.create({
            studentId: juan.id, teacherId: people.laura.id, roomId: room.id, weekday: 2, startTime: '08:00', durationMinutes: 60, validFrom: '2026-11-01',
        });
        const unpaid = await charge(juan, { period: '2026-12' });
        const debt = await charge(juan, { type: 'clase_suelta', period: '2026-11', amount: 65000, calculation: { debt: true } });

        const preview = await lifecycle.archivePreview({ student: juan, now: toUtc('2026-12-02', '10:00') });
        assert.equal(preview.chargesToAnnul, 1);

        const result = await lifecycle.archiveStudent({ student: juan, actor: people.academy, now: toUtc('2026-12-02', '10:00') });
        assert.equal(result.annulledCharges, 1);
        assert.equal((await unpaid.reload()).status, 'anulado');
        assert.equal((await debt.reload()).status, 'por_pagar');

        const notices = await models.NoticeRecipient.findAll({ where: { userId: people.laura.id }, include: [{ model: models.Notice, as: 'notice' }] });
        const notice = notices.map(n => n.notice).find(n => n.category === 'estudiante_archivado');
        assert.ok(notice, 'el profesor recibe el aviso');
        assert.equal(notice.message, 'Juan ya no está en la academia. Su horario contigo (martes 08:00) quedó libre.');

        // With only an annulled charge and a debt, the archived student can be deleted, payments included
        await lifecycle.deleteArchivedStudent({ student: juan, actor: people.academy, now: toUtc('2026-12-02', '11:00') });
        assert.equal(await models.User.findByPk(juan.id), null);
        assert.equal(await models.Payment.count({ where: { studentId: juan.id } }), 0);
    });

    test('un comprobante por revisar frena la eliminación hasta que la academia lo resuelva', async () => {
        const ana = await newStudent('Ana');
        const payment = await charge(ana, { period: '2026-12', status: 'en_revision' });
        await models.PaymentReceipt.create({ paymentId: payment.id, path: 'payment-receipts/ana.jpg', uploadedById: ana.id });
        await lifecycle.archiveStudent({ student: ana, actor: people.academy, now: toUtc('2026-12-03', '10:00') });
        assert.equal((await payment.reload()).status, 'en_revision', 'archivar no toca un comprobante en revisión');

        await assert.rejects(
            lifecycle.deleteArchivedStudent({ student: ana, actor: people.academy, now: toUtc('2026-12-03', '11:00') }),
            { code: 'comprobante_por_revisar' }
        );
        await payment.update({ status: 'rechazado', rejectionReason: 'No se ve el valor' });
        const { receipts } = await lifecycle.deleteArchivedStudent({ student: ana, actor: people.academy, now: toUtc('2026-12-03', '12:00') });
        assert.deepEqual(receipts, ['payment-receipts/ana.jpg']);
        assert.equal(await models.PaymentReceipt.count({ where: { paymentId: payment.id } }), 0);
    });
});
