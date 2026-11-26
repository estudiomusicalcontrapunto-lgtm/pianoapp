// 9. Payments are records: editing or deleting a registered payment fails; a
// correction is a separate adjustment and stays in the history of changes.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase } = require('./helpers');

describe('pagos que no se tocan', () => {
    let models;
    let payments;
    const people = {};
    let payment;

    before(async () => {
        models = await setupDatabase();
        payments = require('../services/paymentService');
        const { User, City } = models;
        const pereira = await City.findOne({ where: { name: 'Pereira' } });
        people.cityId = pereira.id;
        people.academy = await User.create({ name: 'Academia', email: 'academia@t.co', password: 'x-clave-123', role: 'academy' });
        people.sofia = await User.create({ name: 'Sofía', email: 'sofia@t.co', password: 'x-clave-123', role: 'student', cityId: pereira.id });

        payment = await payments.createPayment({
            studentId: people.sofia.id, cityId: people.cityId, type: 'mensualidad', period: '2027-07',
            amount: 260000, dueDate: '2027-07-05', calculation: { monthlyFee: 260000, discounts: [] },
        }, { actor: people.academy });
    });

    after(teardownDatabase);

    test('el pago queda registrado con su tipo, periodo, monto calculado y estado por pagar', async () => {
        const row = await models.Payment.findByPk(payment.id);
        assert.equal(row.type, 'mensualidad');
        assert.equal(row.period, '2027-07');
        assert.equal(row.amount, 260000);
        assert.equal(row.status, 'por_pagar');
        assert.deepEqual(row.calculation, { monthlyFee: 260000, discounts: [] });
    });

    test('editar el monto, el tipo o el periodo falla, también en una actualización masiva', async () => {
        const row = await models.Payment.findByPk(payment.id);
        await assert.rejects(row.update({ amount: 1 }), { code: 'pago_inmutable' });
        await assert.rejects(row.update({ period: '2027-08' }), { code: 'pago_inmutable' });
        await assert.rejects(models.Payment.update({ amount: 1 }, { where: { id: payment.id } }), { code: 'pago_inmutable' });
        assert.equal((await models.Payment.findByPk(payment.id)).amount, 260000);
    });

    test('borrar un pago falla, uno por uno o en grupo', async () => {
        const row = await models.Payment.findByPk(payment.id);
        await assert.rejects(row.destroy(), { code: 'pago_inmutable' });
        await assert.rejects(models.Payment.destroy({ where: { id: payment.id } }), { code: 'pago_inmutable' });
        assert.ok(await models.Payment.findByPk(payment.id));
    });

    test('el estado de revisión sí avanza (aprobar, rechazar con motivo)', async () => {
        const row = await models.Payment.findByPk(payment.id);
        await row.update({ status: 'rechazado', rejectionReason: 'No se ve el valor', reviewedById: people.academy.id, reviewedAt: new Date() });
        assert.equal((await row.reload()).status, 'rechazado');
    });

    test('una corrección crea un ajuste aparte y queda en el historial de cambios', async () => {
        await assert.rejects(payments.recordCorrection({ paymentId: payment.id, amount: -65000, reason: ' ', actor: people.academy }), { code: 'motivo_requerido' });

        const adjustment = await payments.recordCorrection({
            paymentId: payment.id, amount: -65000, reason: 'Se cobró una clase de más', actor: people.academy,
        });
        assert.equal(adjustment.kind, 'correccion');
        assert.equal(adjustment.amount, -65000);

        const history = await payments.paymentHistory(payment.id);
        assert.equal(history.payment.amount, 260000, 'el pago original no cambia');
        assert.equal(history.netAmount, 195000);
        assert.deepEqual(history.changes.map(c => c.action), ['crear', 'ajuste']);
        assert.equal(history.changes[1].details.reason, 'Se cobró una clase de más');

        // The adjustment itself cannot be edited or deleted either
        const row = await models.PaymentAdjustment.findByPk(adjustment.id);
        await assert.rejects(row.update({ amount: -1 }), { code: 'pago_inmutable' });
        await assert.rejects(row.destroy(), { code: 'pago_inmutable' });
    });

    test('un comprobante enviado no se borra', async () => {
        const receipt = await models.PaymentReceipt.create({ paymentId: payment.id, path: 'x.jpg', uploadedById: people.sofia.id });
        await assert.rejects(receipt.destroy(), { code: 'pago_inmutable' });
    });

    test('un estudiante archivado con días de práctica y términos aceptados sí se puede eliminar', async () => {
        const { deleteArchivedStudent } = require('../services/studentLifecycleService');
        const camilo = await models.User.create({ name: 'Camilo', email: 'camilo@t.co', password: 'x-clave-123', role: 'student', cityId: people.cityId, active: false });
        await models.PracticeDay.create({ studentId: camilo.id, date: '2026-11-20' });
        const version = await models.TermsVersion.create({ version: 1, content: 'Términos de prueba de la academia.' });
        await models.TermsAcceptance.create({ userId: camilo.id, termsVersionId: version.id, version: 1, acceptedAt: new Date() });
        await deleteArchivedStudent({ student: camilo, actor: people.academy });
        assert.equal(await models.User.findByPk(camilo.id), null);
        assert.equal(await models.PracticeDay.count({ where: { studentId: camilo.id } }), 0);
    });

    test('un estudiante con un mes pagado se puede eliminar cuando ese mes termina, y se borran sus pagos', async () => {
        const { deleteArchivedStudent } = require('../services/studentLifecycleService');
        const { toUtc } = require('../domain/time');
        await people.sofia.update({ active: false });
        await (await models.Payment.findByPk(payment.id)).update({ status: 'aprobado' });

        // July 2027 is paid: while July lasts she stays archived
        await assert.rejects(
            deleteArchivedStudent({ student: people.sofia, actor: people.academy, now: toUtc('2027-07-31', '20:00') }),
            { code: 'mes_pagado_vigente' }
        );
        assert.ok(await models.Payment.findByPk(payment.id));

        // From August 1st she can be deleted, with her payment, receipt and adjustment
        await deleteArchivedStudent({ student: people.sofia, actor: people.academy, now: toUtc('2027-08-01', '08:00') });
        assert.equal(await models.User.findByPk(people.sofia.id), null);
        assert.equal(await models.Payment.count({ where: { studentId: people.sofia.id } }), 0);
        assert.equal(await models.PaymentReceipt.count({ where: { paymentId: payment.id } }), 0);
        assert.equal(await models.PaymentAdjustment.count({ where: { studentId: people.sofia.id } }), 0);
        // What was deleted stays in the audit log
        const audit = await models.AuditLog.findOne({ where: { entityType: 'student', entityId: people.sofia.id, action: 'eliminar' } });
        assert.equal(audit.details.payments[0].amount, 260000);
    });
});
