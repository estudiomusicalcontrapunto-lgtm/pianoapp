const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { localDate, addDays, weekdayOf, addHours } = require('../domain/time');

const PASSWORD = 'clave-de-prueba-1';

describe('API fase 3: academia', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });

    const login = async (email, password = PASSWORD) => {
        const res = await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password } });
        assert.equal(res.status, 200, `login ${email}: ${res.body?.message}`);
        return res.body;
    };

    before(async () => {
        models = await setupDatabase();
        const { User } = models;
        await User.create({ name: 'Academia', email: 'academia@test.co', password: PASSWORD, role: 'academy' });
        ids.laura = (await User.create({ name: 'Laura', email: 'laura@test.co', password: PASSWORD, role: 'teacher' })).id;
        ids.andres = (await User.create({ name: 'Andrés', email: 'andres@test.co', password: PASSWORD, role: 'teacher' })).id;
        server = await startServer();
        tokens.academy = (await login('academia@test.co')).token;
        tokens.laura = (await login('laura@test.co')).token;
        tokens.andres = (await login('andres@test.co')).token;
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('la academia crea estudiantes con contraseña temporal; el profesor no puede', async () => {
        const forbidden = await call('POST', '/students', 'laura', { name: 'X', email: 'x@test.co' });
        assert.equal(forbidden.status, 403);

        const res = await call('POST', '/students', 'academy', {
            name: 'Sofía', email: 'Sofia@Test.co', teacherId: ids.laura, guardianName: 'Carolina', guardianPhone: '300',
        });
        assert.equal(res.status, 201);
        assert.ok(res.body.tempPassword.length >= 10);
        assert.equal(res.body.student.mustChangePassword, true);
        ids.sofia = res.body.student.id;

        const session = await login('sofia@test.co', res.body.tempPassword);
        assert.equal(session.user.mustChangePassword, true);
        tokens.sofia = session.token;

        const duplicate = await call('POST', '/students', 'academy', { name: 'Otra', email: 'sofia@test.co' });
        assert.equal(duplicate.status, 400);
    });

    test('salones: la academia los crea y asigna; el profesor solo ve los suyos', async () => {
        const salon1 = await call('POST', '/rooms', 'academy', { name: 'Salón 1' });
        const salon2 = await call('POST', '/rooms', 'academy', { name: 'Salón 2' });
        assert.equal(salon2.status, 201);
        ids.salon1 = salon1.body.id;
        ids.salon2 = salon2.body.id;

        const assign = await call('PUT', `/rooms/${ids.salon2}/teachers`, 'academy', { teacherIds: [ids.laura, ids.andres] });
        assert.equal(assign.status, 200);
        await call('PUT', `/rooms/${ids.salon1}/teachers`, 'academy', { teacherIds: [ids.laura] });

        const andresRooms = await call('GET', '/rooms', 'andres');
        assert.deepEqual(andresRooms.body.map(r => r.name), ['Salón 2']);
        const forbiddenWeek = await call('GET', `/rooms/${ids.salon1}/week`, 'andres');
        assert.equal(forbiddenWeek.status, 403);

        // Teacher windows (their own screen comes in phase 4)
        const { Availability } = models;
        await Availability.create({ teacherId: ids.laura, roomId: ids.salon2, weekday: 1, startTime: '08:00', endTime: '12:00', type: 'clase' });
        await Availability.create({ teacherId: ids.andres, roomId: ids.salon2, weekday: 1, startTime: '14:00', endTime: '19:00', type: 'clase' });
    });

    test('valoración: se aparta un horario y otro profesor no puede tomar el salón', async () => {
        const created = await call('POST', '/assessments', 'academy', {
            studentName: 'Mariana', contactName: 'Andrea', contactPhone: '320', contactEmail: 'mariana@test.co',
            scheduledAt: new Date().toISOString(), teacherId: ids.laura,
        });
        assert.equal(created.status, 201);
        ids.assessment = created.body.id;

        const held = await call('POST', `/assessments/${ids.assessment}/hold`, 'academy', { roomId: ids.salon2, weekday: 1, startTime: '09:00' });
        assert.equal(held.status, 200, held.body.message);
        assert.equal(held.body.holdActive, true);
        const hours = (new Date(held.body.holdExpiresAt) - Date.now()) / 3600000;
        assert.ok(hours > 47.9 && hours <= 48);

        // Andrés cannot take the room while Laura's slot is held
        const other = await call('POST', '/assessments', 'academy', {
            studentName: 'Pedro', scheduledAt: new Date().toISOString(), teacherId: ids.andres,
        });
        const taken = await call('POST', `/assessments/${other.body.id}/hold`, 'academy', { roomId: ids.salon2, weekday: 1, startTime: '09:00' });
        assert.equal(taken.status, 409);
        assert.equal(taken.body.code, 'choque_salon');

        // A second assessment of Laura cannot take the held slot
        const second = await call('POST', '/assessments', 'academy', {
            studentName: 'Lucía', scheduledAt: new Date().toISOString(), teacherId: ids.laura,
        });
        ids.secondAssessment = second.body.id;
        const clash = await call('POST', `/assessments/${second.body.id}/hold`, 'academy', { roomId: ids.salon2, weekday: 1, startTime: '09:30' });
        assert.equal(clash.status, 409);
        assert.match(clash.body.message, /apartado para una valoración/);
    });

    test('calendario del salón: la academia ve nombres; el otro profesor solo "Ocupado"', async () => {
        const academyView = await call('GET', `/rooms/${ids.salon2}/week`, 'academy');
        assert.equal(academyView.status, 200);
        assert.equal(academyView.body.days.length, 6);
        const hold = academyView.body.blocks.find(b => b.kind === 'cupo_apartado');
        assert.equal(hold.studentName, 'Mariana');

        const andresView = await call('GET', `/rooms/${ids.salon2}/week`, 'andres');
        const lauraItems = andresView.body.blocks.filter(b => b.kind === 'ocupado');
        assert.ok(lauraItems.length >= 1);
        assert.ok(lauraItems.every(b => !b.studentName && !b.teacherName && b.label === 'Ocupado'));
        // Old class windows are not shown anymore
        assert.ok(!andresView.body.blocks.some(b => b.kind === 'franja_clase'));
    });

    test('convertir la valoración al confirmar el pago crea estudiante, horario fijo y ciclo activo', async () => {
        const res = await call('POST', `/assessments/${ids.assessment}/convert`, 'academy', { plan: 'paquete_4' });
        assert.equal(res.status, 201, res.body.message);
        assert.equal(res.body.cycle.status, 'activo');
        assert.equal(res.body.cycle.paymentStatus, 'pagado');
        assert.equal(res.body.lessons.length, 4);
        assert.ok(res.body.lessons.every(l => weekdayOf(localDate(l.startsAt)) === 1));
        assert.equal(res.body.assessment.status, 'convertida');
        assert.equal(res.body.student.email, 'mariana@test.co');
        assert.equal(res.body.student.guardianName, 'Andrea');
        ids.mariana = res.body.student.id;
        ids.marianaCycle = res.body.cycle.id;

        const again = await call('POST', `/assessments/${ids.assessment}/convert`, 'academy', {});
        assert.equal(again.status, 409);

        const students = await call('GET', '/students', 'academy');
        const mariana = students.body.find(s => s.id === ids.mariana);
        assert.equal(mariana.fixedSchedules[0].startTime, '09:00');
        assert.equal(mariana.openCycles.length, 1);
    });

    test('un cupo vencido se puede convertir si el horario sigue libre', async () => {
        await call('POST', `/assessments/${ids.secondAssessment}/hold`, 'academy', { roomId: ids.salon2, weekday: 1, startTime: '11:00' });
        await models.Assessment.update({ holdExpiresAt: addHours(new Date(), -1) }, { where: { id: ids.secondAssessment } });
        const res = await call('POST', `/assessments/${ids.secondAssessment}/convert`, 'academy', { email: 'lucia@test.co' });
        assert.equal(res.status, 201, res.body.message);
    });

    test('mensualidades: no se superponen, se rechaza con motivo y se confirma', async () => {
        const overlapping = await call('POST', '/cycles', 'academy', { studentId: ids.mariana, startDate: localDate(new Date()) });
        assert.equal(overlapping.status, 409);

        const suggested = await call('GET', `/cycles/suggest-start?studentId=${ids.mariana}`, 'academy');
        assert.equal(weekdayOf(suggested.body.startDate), 1);

        const created = await call('POST', '/cycles', 'academy', { studentId: ids.mariana, plan: 'paquete_4' });
        assert.equal(created.status, 201, created.body.message);
        assert.equal(created.body.amount, 260000);
        assert.equal(created.body.paymentStatus, 'pendiente');
        assert.equal(created.body.startDate, suggested.body.startDate);

        const noReason = await call('POST', `/cycles/${created.body.id}/reject`, 'academy', {});
        assert.equal(noReason.status, 400);
        const rejected = await call('POST', `/cycles/${created.body.id}/reject`, 'academy', { reason: 'El comprobante no se lee' });
        assert.equal(rejected.body.rejectionReason, 'El comprobante no se lee');

        const confirmed = await call('POST', `/cycles/${created.body.id}/confirm`, 'academy', {});
        assert.equal(confirmed.status, 200, confirmed.body.message);
        assert.equal(confirmed.body.status, 'activo');
        assert.equal(confirmed.body.summary.total, 4);

        const cancelActive = await call('POST', `/cycles/${created.body.id}/cancel`, 'academy', {});
        assert.equal(cancelActive.status, 409);
    });

    test('sin horario, el pago confirmado deja el ciclo por agendar y el profesor lo agenda', async () => {
        const created = await call('POST', '/cycles', 'academy', { studentId: ids.sofia, startDate: addDays(localDate(new Date()), 7) });
        assert.equal(created.status, 201);
        const confirmed = await call('POST', `/cycles/${created.body.id}/confirm`, 'academy', {});
        assert.equal(confirmed.status, 200, confirmed.body.message);
        assert.equal(confirmed.body.status, 'activo');
        assert.equal(confirmed.body.summary.unscheduled, true);

        const teacherNotices = await call('GET', '/notices', 'laura');
        assert.match(teacherNotices.body[0].message, /Sofía ya pagó su mensualidad\. Agéndale su horario/);

        // The next Tuesday after today (today's 10:00 may have passed already)
        let tuesday = addDays(localDate(new Date()), 1);
        while (weekdayOf(tuesday) !== 2) tuesday = addDays(tuesday, 1);
        const scheduled = await call('POST', '/fixed-schedules', 'laura', { studentId: ids.sofia, roomId: ids.salon2, weekday: 2, startTime: '10:00', validFrom: tuesday });
        assert.equal(scheduled.status, 201, scheduled.body.message);
        assert.equal(scheduled.body.scheduled, 4);
        const cycle = (await call('GET', `/cycles?studentId=${ids.sofia}`, 'academy')).body.find(c => c.id === created.body.id);
        assert.equal(cycle.summary.unscheduled, false);
        assert.equal(weekdayOf(cycle.startDate), 2);
    });

    test('cada rol ve solo sus mensualidades', async () => {
        const sofia = await call('GET', '/cycles', 'sofia');
        assert.ok(sofia.body.length > 0 && sofia.body.every(c => c.studentId === ids.sofia));
        const andres = await call('GET', '/cycles', 'andres');
        assert.equal(andres.body.length, 0);
        const laura = await call('GET', '/cycles', 'laura');
        assert.ok(laura.body.some(c => c.studentId === ids.mariana));
    });
});
