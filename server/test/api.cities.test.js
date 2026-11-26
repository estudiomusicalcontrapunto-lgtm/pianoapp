const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');

describe('API ciudades', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const PASSWORD = 'clave-de-prueba-1';

    const call = (method, url, who, body) => request(server.baseUrl, method, url, { token: tokens[who], body });

    before(async () => {
        models = await setupDatabase();
        const { User, Instrument } = models;
        ids.pereira = (await models.City.findOne({ where: { name: 'Pereira' } })).id;
        ids.piano = (await Instrument.findOne({ where: { name: 'Piano' } })).id;
        await User.create({ name: 'Academia', email: 'academia@test.co', password: PASSWORD, role: 'academy' });
        server = await startServer();
        for (const [who, email] of [['academy', 'academia@test.co']]) {
            tokens[who] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } })).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('la migración crea Pereira con 260.000 y clase suelta de 65.000', async () => {
        const res = await call('GET', '/cities', 'academy');
        assert.equal(res.status, 200);
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].name, 'Pereira');
        assert.deepEqual(res.body[0].prices, { monthlyFee: 260000, singleClassFee: 65000, singleSource: 'mensualidad' });
    });

    test('la academia crea una ciudad nueva con su mensualidad y su texto de pago', async () => {
        const repeated = await call('POST', '/cities', 'academy', { name: 'Pereira', monthlyFee: 1 });
        assert.equal(repeated.status, 409);
        const invalid = await call('POST', '/cities', 'academy', { name: 'Medellín', monthlyFee: '' });
        assert.equal(invalid.status, 400);
        assert.match(invalid.body.message, /mensualidad es obligatoria/);

        const created = await call('POST', '/cities', 'academy', { name: 'Medellín', monthlyFee: '300.000', paymentText: 'Nequi Medellín' });
        assert.equal(created.status, 201, created.body.message);
        ids.medellin = created.body.id;
        assert.equal(created.body.prices.monthlyFee, 300000);
        assert.equal(created.body.prices.singleClassFee, 75000);

        const updated = await call('PUT', `/cities/${ids.medellin}`, 'academy', { singleClassFee: 80000 });
        assert.equal(updated.body.prices.singleClassFee, 80000);
    });

    test('profesores, salones y estudiantes quedan en una ciudad; con varias hay que elegirla', async () => {
        const noCity = await call('POST', '/academy/teachers', 'academy', {
            name: 'Laura', email: 'laura@test.co', password: PASSWORD, instrumentIds: [ids.piano],
        });
        assert.equal(noCity.status, 400);
        assert.match(noCity.body.message, /Elige la ciudad/);

        const laura = await call('POST', '/academy/teachers', 'academy', {
            name: 'Laura', email: 'laura@test.co', password: PASSWORD, instrumentIds: [ids.piano], cityId: ids.pereira,
        });
        assert.equal(laura.status, 201, laura.body.message);
        ids.laura = laura.body.id;

        // A student takes their teacher's city
        const student = await call('POST', '/students', 'academy', { name: 'Sofía', email: 'sofia@test.co', teacherId: ids.laura });
        assert.equal(student.status, 201, student.body.message);
        assert.equal(student.body.student.cityId, ids.pereira);
        const otherCity = await call('POST', '/students', 'academy', {
            name: 'Tomás', email: 'tomas@test.co', teacherId: ids.laura, cityId: ids.medellin,
        });
        assert.equal(otherCity.status, 400);
        assert.match(otherCity.body.message, /otra ciudad/);

        // Room names repeat across cities, not within one
        const salonPereira = await call('POST', '/rooms', 'academy', { name: 'Salón 1', cityId: ids.pereira });
        assert.equal(salonPereira.status, 201, salonPereira.body.message);
        const salonMedellin = await call('POST', '/rooms', 'academy', { name: 'Salón 1', cityId: ids.medellin });
        assert.equal(salonMedellin.status, 201, salonMedellin.body.message);
        const repeated = await call('POST', '/rooms', 'academy', { name: 'Salón 1', cityId: ids.pereira });
        assert.equal(repeated.status, 400);

        // A teacher teaches only in rooms of their city
        const wrongRoom = await call('PUT', `/rooms/${salonMedellin.body.id}/teachers`, 'academy', { teacherIds: [ids.laura] });
        assert.equal(wrongRoom.status, 400);
        assert.match(wrongRoom.body.message, /otra ciudad/);
        const rightRoom = await call('PUT', `/rooms/${salonPereira.body.id}/teachers`, 'academy', { teacherIds: [ids.laura] });
        assert.equal(rightRoom.status, 200);
    });

    test('al profesor solo se le cambia la ciudad: ni precios ni texto de pago propios', async () => {
        const text = await call('PUT', `/academy/teachers/${ids.laura}/billing`, 'academy', { paymentText: 'Bancolombia de Laura', monthlyFee: 999 });
        assert.equal(text.status, 200, text.body.message);
        assert.equal('paymentText' in text.body, false);
        assert.equal('monthlyFee' in text.body, false);

        const teachers = await call('GET', '/academy/teachers', 'academy');
        const laura = teachers.body.find(t => t.id === ids.laura);
        assert.equal(laura.cityName, 'Pereira');
        assert.equal(laura.prices.monthlyFee, 260000);

        // With students or rooms in Pereira, Laura cannot move to Medellín
        const move = await call('PUT', `/academy/teachers/${ids.laura}/billing`, 'academy', { cityId: ids.medellin });
        assert.equal(move.status, 409);
    });

    test('una ciudad con gente activa no se puede desactivar', async () => {
        const res = await call('PUT', `/cities/${ids.pereira}`, 'academy', { active: false });
        assert.equal(res.status, 409);
    });

    test('un profesor de otra ciudad no puede reemplazar una clase', async () => {
        const { assignSubstitute, getAbsenceDetail } = require('../services/substitutionService');
        const andres = await call('POST', '/academy/teachers', 'academy', {
            name: 'Andrés', email: 'andres@test.co', password: PASSWORD, instrumentIds: [ids.piano], cityId: ids.medellin,
        });
        assert.equal(andres.status, 201, andres.body.message);
        const sofia = await models.User.findOne({ where: { email: 'sofia@test.co' } });
        const room = await models.Room.findOne({ where: { name: 'Salón 1', cityId: ids.pereira } });
        const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
        const lesson = await models.Lesson.create({
            studentId: sofia.id, teacherId: ids.laura, roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + 3600000),
        });
        const academy = await models.User.findOne({ where: { role: 'academy' } });
        await assert.rejects(
            assignSubstitute({ lessonIds: [lesson.id], substitute: { teacherId: andres.body.id }, actor: academy }),
            { code: 'ciudad_distinta' }
        );

        // And Andrés is not offered as a candidate for Laura's absence
        const absence = await models.TeacherAbsence.create({ teacherId: ids.laura, startDate: '2000-01-01', endDate: '2100-01-01', reason: 'Prueba' });
        const detail = await getAbsenceDetail({ id: absence.id });
        assert.equal(detail.lessons.flatMap(l => l.candidates).some(c => c.id === andres.body.id), false);
        await absence.destroy();
        await lesson.destroy();
    });

    test('una ciudad se elimina solo si nadie la usa; la última no', async () => {
        // Medellín has a room and Andrés
        const inUse = await call('DELETE', `/cities/${ids.medellin}`, 'academy');
        assert.equal(inUse.status, 409);
        assert.match(inUse.body.message, /^No puedes eliminar Medellín porque tiene 1 profesor\(es\), 1 salón\(es\)\. Si ya no la usas, desactívala\.$/);

        // A city created by mistake, with a teacher already removed from the academy: it can go
        const bogota = await call('POST', '/cities', 'academy', { name: 'Bogotá', monthlyFee: '280000' });
        const marta = await call('POST', '/academy/teachers', 'academy', {
            name: 'Marta', email: 'marta@test.co', password: PASSWORD, instrumentIds: [ids.piano], cityId: bogota.body.id,
        });
        assert.equal((await call('DELETE', `/academy/teachers/${marta.body.id}`, 'academy')).status, 200);
        const removed = await call('DELETE', `/cities/${bogota.body.id}`, 'academy');
        assert.equal(removed.status, 200, removed.body.message);
        assert.equal((await models.User.findByPk(marta.body.id)).cityId, null);
        assert.deepEqual((await call('GET', '/cities', 'academy')).body.map(c => c.name), ['Medellín', 'Pereira']);

        // An archived student keeps the city in use (they can come back)
        const cali = await call('POST', '/cities', 'academy', { name: 'Cali', monthlyFee: '250000' });
        await models.User.create({ name: 'Ana', email: 'ana@test.co', password: PASSWORD, role: 'student', cityId: cali.body.id, active: false });
        const archived = await call('DELETE', `/cities/${cali.body.id}`, 'academy');
        assert.equal(archived.status, 409);
        assert.match(archived.body.message, /1 estudiante\(s\)/);
    });

    test('un salón se elimina solo si nunca se usó; así la ciudad queda libre', async () => {
        const used = await models.Room.findOne({ where: { name: 'Salón 1', cityId: ids.pereira } });
        await models.FixedSchedule.create({
            studentId: (await models.User.findOne({ where: { email: 'sofia@test.co' } })).id, teacherId: ids.laura, roomId: used.id,
            weekday: 2, startTime: '15:00', durationMinutes: 60, validFrom: '2027-01-01',
        });
        const blocked = await call('DELETE', `/rooms/${used.id}`, 'academy');
        assert.equal(blocked.status, 409);
        assert.match(blocked.body.message, /1 horario\(s\) semanal\(es\)\. Si ya no lo usas, desactívalo\./);

        const tunja = await call('POST', '/cities', 'academy', { name: 'Tunja', monthlyFee: '200000' });
        const room = await call('POST', '/rooms', 'academy', { name: 'Salón Tunja', cityId: tunja.body.id });
        assert.equal((await call('DELETE', `/cities/${tunja.body.id}`, 'academy')).status, 409);
        assert.equal((await call('DELETE', `/rooms/${room.body.id}`, 'academy')).status, 200);
        assert.equal((await call('DELETE', `/cities/${tunja.body.id}`, 'academy')).status, 200);
    });

    test('la única ciudad activa no se puede desactivar', async () => {
        // Medellín has Andrés (active): move him out of the way by removing him and his room assignment
        await call('DELETE', `/academy/teachers/${(await models.User.findOne({ where: { email: 'andres@test.co' } })).id}`, 'academy');
        assert.equal((await call('PUT', `/cities/${ids.medellin}`, 'academy', { active: false })).status, 200);
        const cali = await models.City.findOne({ where: { name: 'Cali' } });
        assert.equal((await call('PUT', `/cities/${cali.id}`, 'academy', { active: false })).status, 200);
        // Only Pereira is active now: it has people, and it is also the last active one
        const last = await call('PUT', `/cities/${ids.pereira}`, 'academy', { active: false });
        assert.equal(last.status, 409);
    });
});
