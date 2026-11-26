// Payments API: the student sends one receipt per payment, the academy approves
// or rejects it with a reason, and a registered payment is never edited or deleted.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request, upload } = require('./helpers');
const { localDate, addDays, addMonths } = require('../domain/time');

const PASSWORD = 'clave-de-prueba-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d90000000049454e44ae426082', 'hex');

describe('API de pagos', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const sendReceipt = (role, paymentId, file = { filename: 'pago.png', type: 'image/png', content: PNG }) =>
        upload(server.baseUrl, `/payments/${paymentId}/receipt`, { token: tokens[role], field: 'receipt', ...file });

    before(async () => {
        models = await setupDatabase();
        const { User, City } = models;
        const pereira = await City.findOne({ where: { name: 'Pereira' } });
        const create = (data) => User.create({ password: PASSWORD, cityId: data.role === 'academy' ? null : pereira.id, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.sofia = (await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.valen = (await create({ name: 'Valentina', email: 'valen@test.co', role: 'student', teacherId: ids.laura })).id;
        await City.update({ paymentText: 'Nequi 300 123 4567' }, { where: { id: pereira.id } });

        const { createPayment } = require('../services/paymentService');
        const period = localDate(new Date()).slice(0, 7);
        ids.payment = (await createPayment({
            studentId: ids.sofia, cityId: pereira.id, teacherId: ids.laura, type: 'mensualidad', period,
            amount: 260000, dueDate: addDays(localDate(new Date()), 3), calculation: { monthlyFee: 260000, discounts: [] },
        })).id;

        server = await startServer();
        for (const [role, email] of [['academy', 'academia@test.co'], ['laura', 'laura@test.co'], ['sofia', 'sofia@test.co'], ['valen', 'valen@test.co']]) {
            tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } })).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('el estudiante ve su pago, cuántos días le quedan y el texto de pago de su ciudad', async () => {
        const res = await call('GET', '/payments/me', 'sofia');
        assert.equal(res.status, 200);
        assert.equal(res.body.paymentText, 'Nequi 300 123 4567');
        const [payment] = res.body.payments;
        assert.equal(payment.amount, 260000);
        assert.equal(payment.status, 'por_pagar');
        assert.equal(payment.standing.state, 'pendiente');
        assert.equal(payment.standing.daysLeft, 3);
        assert.match(payment.description, /^la mensualidad de /);

        const overview = await call('GET', '/students/me/overview', 'sofia');
        assert.equal(overview.body.payment.id, ids.payment);
        assert.equal(overview.body.paymentsToPay, 1);
    });

    test('comprobante: una foto o un PDF; solo el estudiante dueño; queda en revisión', async () => {
        const txt = await sendReceipt('sofia', ids.payment, { filename: 'nota.txt', type: 'text/plain', content: 'hola' });
        assert.equal(txt.status, 400);
        const foreign = await sendReceipt('valen', ids.payment);
        assert.equal(foreign.status, 403);

        const ok = await sendReceipt('sofia', ids.payment);
        assert.equal(ok.status, 200, ok.body?.message);
        assert.equal(ok.body.status, 'en_revision');
        assert.equal(ok.body.receipts.length, 1);

        // Only one receipt at a time
        const again = await sendReceipt('sofia', ids.payment);
        assert.equal(again.status, 409);
        assert.match(again.body.message, /está en revisión/);

        const notices = await call('GET', '/notices', 'academy');
        assert.match(notices.body[0].message, /Sofía subió el comprobante de la mensualidad de .+ \(\$260\.000\)/);
    });

    test('solo la academia ve, aprueba y rechaza pagos; el profesor no', async () => {
        assert.equal((await call('POST', `/payments/${ids.payment}/approve`, 'laura')).status, 403);
        assert.equal((await call('POST', `/payments/${ids.payment}/reject`, 'laura', { reason: 'x' })).status, 403);
        assert.equal((await call('GET', '/payments', 'laura')).status, 403);
        assert.equal((await call('PUT', '/settings', 'academy', { aprueba_pagos: 'profesor' })).status, 400);
    });

    test('rechazar exige un motivo; el estudiante lo ve y puede subir otro comprobante', async () => {
        const noReason = await call('POST', `/payments/${ids.payment}/reject`, 'academy', { reason: '' });
        assert.equal(noReason.status, 400);
        const rejected = await call('POST', `/payments/${ids.payment}/reject`, 'academy', { reason: 'No se ve el valor' });
        assert.equal(rejected.status, 200, rejected.body.message);
        assert.equal(rejected.body.status, 'rechazado');
        assert.equal(rejected.body.rejectionReason, 'No se ve el valor');

        const notice = (await call('GET', '/notices', 'sofia')).body[0];
        assert.match(notice.message, /No pudimos aprobar tu comprobante de la mensualidad de .+: No se ve el valor\. Sube otro a más tardar el/);

        const second = await sendReceipt('sofia', ids.payment, { filename: 'pago.pdf', type: 'application/pdf', content: '%PDF-1.4 prueba' });
        assert.equal(second.status, 200);
        // The rejected receipt stays in the history
        assert.deepEqual(second.body.receipts.map(r => r.status), ['rechazado', 'en_revision']);
    });

    test('la academia aprueba y el estudiante abre su comprobante; otro estudiante no', async () => {
        const approved = await call('POST', `/payments/${ids.payment}/approve`, 'academy');
        assert.equal(approved.body.status, 'aprobado');
        assert.equal(approved.body.standing.state, 'al_dia');
        const receiptId = approved.body.receipts[1].id;
        const file = await fetch(`${server.baseUrl}/payments/${ids.payment}/receipts/${receiptId}`, { headers: { Authorization: `Bearer ${tokens.sofia}` } });
        assert.equal(file.status, 200);
        assert.equal((await call('GET', `/payments/${ids.payment}/receipts/${receiptId}`, 'valen')).status, 403);

        const after = await sendReceipt('sofia', ids.payment);
        assert.equal(after.status, 409);
    });

    test('sin cobro este mes, el Inicio muestra la mensualidad del mes siguiente ya pagada', async () => {
        const { createPayment } = require('../services/paymentService');
        const pereira = await models.City.findOne({ where: { name: 'Pereira' } });
        const nextMonth = addMonths(localDate(new Date()).slice(0, 7), 1);
        const advance = await createPayment({
            studentId: ids.valen, cityId: pereira.id, teacherId: ids.laura, type: 'mensualidad', period: nextMonth,
            amount: 260000, dueDate: `${nextMonth}-05`, calculation: { monthlyFee: 260000, discounts: [] },
        });
        await models.Payment.update({ status: 'aprobado' }, { where: { id: advance.id } });

        const overview = await call('GET', '/students/me/overview', 'valen');
        assert.equal(overview.body.payment.id, advance.id);
        assert.equal(overview.body.payment.standing.state, 'al_dia');
        assert.equal(overview.body.paymentsToPay, 0);
    });

    test('9. editar o borrar un pago registrado falla; la corrección es un ajuste en el historial', async () => {
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
            const res = await call(method, `/payments/${ids.payment}`, 'academy', { amount: 1 });
            assert.equal(res.status, 409, method);
            assert.equal(res.body.code, 'pago_inmutable');
        }
        assert.equal((await models.Payment.findByPk(ids.payment)).amount, 260000);

        assert.equal((await call('POST', `/payments/${ids.payment}/adjustments`, 'sofia', { amount: -1000, reason: 'x' })).status, 403);
        const adjustment = await call('POST', `/payments/${ids.payment}/adjustments`, 'academy', { amount: -65000, reason: 'Se cobró una clase de más' });
        assert.equal(adjustment.status, 201, adjustment.body.message);

        const history = await call('GET', `/payments/${ids.payment}/history`, 'sofia');
        assert.equal(history.body.payment.amount, 260000);
        assert.equal(history.body.netAmount, 195000);
        assert.deepEqual(history.body.changes.map(c => c.action), ['crear', 'subir_comprobante', 'rechazar', 'subir_comprobante', 'aprobar', 'ajuste']);
    });

    test('la academia cobra una clase suelta aparte (clase extra)', async () => {
        const date = addDays(localDate(new Date()), 10);
        const res = await call('POST', '/payments/single-class', 'academy', { studentId: ids.valen, date });
        assert.equal(res.status, 201, res.body.message);
        assert.equal(res.body.type, 'clase_suelta');
        assert.equal(res.body.amount, 65000);
        assert.equal(res.body.dueDate, date);
    });
});
