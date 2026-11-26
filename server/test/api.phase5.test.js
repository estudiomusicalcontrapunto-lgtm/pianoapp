const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupDatabase, teardownDatabase, startServer, request, upload, uploads } = require('./helpers');
const { localDate, addDays, weekdayOf, localParts } = require('../domain/time');

const PASSWORD = 'clave-de-prueba-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d90000000049454e44ae426082', 'hex');

describe('API fase 5: estudiante', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });

    before(async () => {
        models = await setupDatabase();
        const { User, Room, TeacherRoom, Availability, FixedSchedule } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.sofia = (await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.valen = (await create({ name: 'Valentina', email: 'valen@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.salon = (await Room.create({ name: 'Salón 2' })).id;
        await TeacherRoom.create({ teacherId: ids.laura, roomId: ids.salon });

        // Class windows every weekday morning and a Saturday afternoon make-up window
        for (let weekday = 1; weekday <= 6; weekday++) {
            await Availability.create({ teacherId: ids.laura, roomId: ids.salon, weekday, startTime: '08:00', endTime: '12:00', type: 'clase' });
        }
        await Availability.create({ teacherId: ids.laura, roomId: ids.salon, weekday: 6, startTime: '14:00', endTime: '16:00', type: 'reposicion', capacity: 2 });

        // Sofía's class three or four days from now, so the next one is well over 24 h away
        let classDay = addDays(localDate(new Date()), 3);
        if (weekdayOf(classDay) === 7) classDay = addDays(classDay, 1);
        await FixedSchedule.create({
            studentId: ids.sofia, teacherId: ids.laura, roomId: ids.salon,
            weekday: weekdayOf(classDay), startTime: '09:00', durationMinutes: 60, validFrom: localDate(new Date()),
        });

        server = await startServer();
        for (const [role, email] of [['academy', 'academia@test.co'], ['laura', 'laura@test.co'], ['sofia', 'sofia@test.co'], ['valen', 'valen@test.co']]) {
            tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } })).body.token;
        }

        const cycle = await call('POST', '/cycles', 'academy', { studentId: ids.sofia, startDate: localDate(new Date()) });
        const confirmed = await call('POST', `/cycles/${cycle.body.id}/confirm`, 'academy', {});
        assert.equal(confirmed.status, 200, confirmed.body.message);
        ids.cycleEnd = confirmed.body.endDate;
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('el resumen muestra la próxima clase, hasta cuándo se puede cambiar y la mensualidad', async () => {
        const res = await call('GET', '/students/me/overview', 'sofia');
        assert.equal(res.status, 200);
        assert.equal(res.body.nextLesson.roomName, 'Salón 2');
        assert.equal(res.body.nextLesson.rule.ok, true);
        assert.match(res.body.nextLesson.rule.message, /^Puedes cambiar esta clase hasta .+ a las \d{1,2}:\d{2} [ap]\.m\.$/);
        assert.equal(res.body.currentCycle.summary.total, 4);
        assert.equal(res.body.currentCycle.summary.units[0].state, 'proxima');
        assert.equal(res.body.nextPayment, null);
        assert.equal(res.body.teacherName, 'Laura');

        assert.equal((await call('GET', '/students/me/overview', 'laura')).status, 403);
    });

    test('opciones para cambiar la clase: solo franjas de reposición del mismo mes, con 12 horas de anticipación', async () => {
        const next = (await call('GET', '/students/me/overview', 'sofia')).body.nextLesson;
        const res = await call('GET', `/lessons/${next.id}/reschedule-options`, 'sofia');
        assert.equal(res.status, 200);
        assert.equal(res.body.month, localDate(next.startsAt).slice(0, 7));
        assert.ok(res.body.options.length > 0);
        for (const option of res.body.options) {
            const { date, time, weekday } = localParts(option.startsAt);
            assert.equal(weekday, 6);
            assert.ok(['14:00', '15:00'].includes(time));
            assert.equal(date.slice(0, 7), res.body.month);
            assert.ok(new Date(option.startsAt) - Date.now() >= 12 * 3600 * 1000);
        }
        // The latest option, so the next lesson afterwards is still more than 24 h away
        ids.option = res.body.options[res.body.options.length - 1];
    });

    test('otro estudiante no puede reprogramar la clase de Sofía', async () => {
        const overview = await call('GET', '/students/me/overview', 'sofia');
        const res = await call('POST', `/lessons/${overview.body.nextLesson.id}/reschedule`, 'valen', {
            availabilityId: ids.option.availabilityId, startsAt: ids.option.startsAt,
        });
        assert.equal(res.status, 403);
    });

    test('cambiar una clase avisa al profesor; la reposición ya no se puede cambiar, pero las demás clases sí', async () => {
        const overview = await call('GET', '/students/me/overview', 'sofia');
        const lessonId = overview.body.nextLesson.id;
        const res = await call('POST', `/lessons/${lessonId}/reschedule`, 'sofia', {
            availabilityId: ids.option.availabilityId, startsAt: ids.option.startsAt,
        });
        assert.equal(res.status, 200, res.body.message);
        assert.equal(res.body.makeup.kind, 'reposicion');

        const notices = await call('GET', '/notices', 'laura');
        assert.match(notices.body[0].message, /^Sofía cambió su clase del .+ para el .+\.$/);

        const makeup = await call('GET', `/lessons/${res.body.makeup.id}/reschedule-options`, 'sofia');
        assert.equal(makeup.body.rule.ok, false);
        assert.equal(makeup.body.rule.code, 'reposicion_no_cambia');
        assert.deepEqual(makeup.body.options, []);

        // No limit: the next regular class can be changed too
        const lessons = (await call('GET', '/lessons', 'sofia')).body;
        const regular = lessons.find(l => l.kind === 'regular' && l.status === 'programada' && new Date(l.startsAt) > new Date());
        const second = await call('GET', `/lessons/${regular.id}/reschedule-options`, 'sofia');
        assert.equal(second.body.rule.ok, true, second.body.rule.message);
    });

    test('con el tope mensual activo, el cambio que lo supera se rechaza', async () => {
        await call('PUT', '/settings', 'academy', { tope_cambios_mes: 1 });
        const lessons = (await call('GET', '/lessons', 'sofia')).body;
        const sameMonth = lessons.find(l => l.kind === 'regular' && l.status === 'programada'
            && localDate(l.startsAt).slice(0, 7) === localDate(ids.option.startsAt).slice(0, 7) && new Date(l.startsAt) > new Date());
        if (sameMonth) {
            const res = await call('GET', `/lessons/${sameMonth.id}/reschedule-options`, 'sofia');
            assert.equal(res.body.rule.code, 'tope_mensual');
        }
        await call('PUT', '/settings', 'academy', { tope_cambios_mes: 0 });
    });

    test('comprobante: solo JPG, PNG o PDF; pasa a revisión y avisa a la academia', async () => {
        const next = await call('POST', '/cycles', 'academy', { studentId: ids.sofia });
        assert.equal(next.status, 201, next.body.message);
        ids.nextCycle = next.body.id;

        const overview = await call('GET', '/students/me/overview', 'sofia');
        assert.equal(overview.body.nextPayment.amount, 260000);

        const txt = await upload(server.baseUrl, `/cycles/${ids.nextCycle}/receipt`, {
            token: tokens.sofia, field: 'receipt', filename: 'nota.txt', type: 'text/plain', content: 'hola',
        });
        assert.equal(txt.status, 400);

        const foreign = await upload(server.baseUrl, `/cycles/${ids.nextCycle}/receipt`, {
            token: tokens.valen, field: 'receipt', filename: 'pago.png', type: 'image/png', content: PNG,
        });
        assert.equal(foreign.status, 403);

        const ok = await upload(server.baseUrl, `/cycles/${ids.nextCycle}/receipt`, {
            token: tokens.sofia, field: 'receipt', filename: 'pago.png', type: 'image/png', content: PNG,
        });
        assert.equal(ok.status, 200, ok.body?.message);
        assert.equal(ok.body.paymentStatus, 'en_revision');
        assert.equal(ok.body.hasReceipt, true);
        const firstFile = (await models.Cycle.findByPk(ids.nextCycle)).receiptPath;

        const academyNotices = await call('GET', '/notices', 'academy');
        assert.match(academyNotices.body[0].message, /Sofía subió el comprobante/);

        const file = await fetch(`${server.baseUrl}/cycles/${ids.nextCycle}/receipt`, { headers: { Authorization: `Bearer ${tokens.sofia}` } });
        assert.equal(file.status, 200);
        assert.equal(file.headers.get('content-type'), 'image/png');
        assert.equal((await call('GET', `/cycles/${ids.nextCycle}/receipt`, 'valen')).status, 403);

        // A new receipt replaces the previous file
        await new Promise(resolve => setTimeout(resolve, 5));
        const again = await upload(server.baseUrl, `/cycles/${ids.nextCycle}/receipt`, {
            token: tokens.sofia, field: 'receipt', filename: 'pago.pdf', type: 'application/pdf', content: '%PDF-1.4 prueba',
        });
        assert.equal(again.status, 200);
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(fs.existsSync(path.join(uploads, firstFile)), false);
    });

    test('ya pagada, la mensualidad no acepta más comprobantes', async () => {
        await call('POST', `/cycles/${ids.nextCycle}/confirm`, 'academy', {});
        const res = await upload(server.baseUrl, `/cycles/${ids.nextCycle}/receipt`, {
            token: tokens.sofia, field: 'receipt', filename: 'pago.png', type: 'image/png', content: PNG,
        });
        assert.equal(res.status, 409);
    });
});
