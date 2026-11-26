const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { LEVELS, levelLabel } = require('../domain/levels');

const PASSWORD = 'clave-de-prueba-1';

describe('API: instrumentos y nivel Inicial', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });

    before(async () => {
        models = await setupDatabase();
        const { User } = models;
        await User.create({ name: 'Academia', email: 'academia@test.co', password: PASSWORD, role: 'academy' });
        server = await startServer();
        tokens.academy = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email: 'academia@test.co', password: PASSWORD } })).body.token;
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('Inicial es el primer nivel', () => {
        assert.equal(LEVELS[0], 'Inicial');
        assert.equal(levelLabel('Inicial'), 'Inicial');
        assert.equal(levelLabel('3'), 'Nivel 3');
    });

    test('la migración crea Piano y la academia agrega instrumentos sin repetir nombres', async () => {
        const list = await call('GET', '/instruments', 'academy');
        assert.deepEqual(list.body.map(i => i.name), ['Piano']);
        ids.piano = list.body[0].id;

        const guitar = await call('POST', '/instruments', 'academy', { name: 'Guitarra' });
        assert.equal(guitar.status, 201);
        ids.guitar = guitar.body.id;
        assert.equal((await call('POST', '/instruments', 'academy', { name: ' guitarra ' })).status, 400);
        assert.equal((await call('POST', '/instruments', 'academy', { name: '' })).status, 400);
    });

    test('el profesor se crea con sus instrumentos', async () => {
        const without = await call('POST', '/academy/teachers', 'academy', { name: 'Laura', email: 'laura@test.co', password: PASSWORD });
        assert.equal(without.status, 400);

        const laura = await call('POST', '/academy/teachers', 'academy', { name: 'Laura', email: 'laura@test.co', password: PASSWORD, instrumentIds: [ids.piano] });
        assert.equal(laura.status, 201);
        ids.laura = laura.body.id;
        const andres = await call('POST', '/academy/teachers', 'academy', { name: 'Andrés', email: 'andres@test.co', password: PASSWORD, instrumentIds: [ids.piano, ids.guitar] });
        ids.andres = andres.body.id;

        const teachers = await call('GET', '/academy/teachers', 'academy');
        assert.deepEqual(teachers.body.find(t => t.id === ids.andres).instrumentNames.sort(), ['Guitarra', 'Piano']);

        tokens.laura = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email: 'laura@test.co', password: PASSWORD } })).body.token;
        assert.equal((await call('POST', '/instruments', 'laura', { name: 'Violín' })).status, 403);
    });

    test('el estudiante nuevo empieza en Inicial con el instrumento de su profesor', async () => {
        const res = await call('POST', '/students', 'academy', { name: 'Sofía', email: 'sofia@test.co', teacherId: ids.laura });
        assert.equal(res.status, 201);
        assert.equal(res.body.student.level, 'Inicial');
        assert.equal(res.body.student.instrumentId, ids.piano);
        ids.sofia = res.body.student.id;

        // Andrés teaches two instruments and the academy has two: nothing to infer
        const tomas = await call('POST', '/students', 'academy', { name: 'Tomás', email: 'tomas@test.co', teacherId: ids.andres });
        assert.equal(tomas.body.student.instrumentId, null);

        const list = await call('GET', '/students', 'academy');
        assert.equal(list.body.find(s => s.id === ids.sofia).instrumentName, 'Piano');
    });

    test('el profesor debe enseñar el instrumento del estudiante y el nivel debe existir', async () => {
        const wrong = await call('POST', '/students', 'academy', { name: 'Juan', email: 'juan@test.co', teacherId: ids.laura, instrumentId: ids.guitar });
        assert.equal(wrong.status, 400);
        assert.equal(wrong.body.code, 'profesor_sin_instrumento');

        assert.equal((await call('PUT', `/students/${ids.sofia}`, 'academy', { instrumentId: ids.guitar })).status, 400);
        assert.equal((await call('PUT', `/students/${ids.sofia}`, 'academy', { level: 'Experto' })).status, 400);

        // Changing instrument and teacher together is fine
        const moved = await call('PUT', `/students/${ids.sofia}`, 'academy', { instrumentId: ids.guitar, teacherId: ids.andres, level: '2' });
        assert.equal(moved.status, 200);
        assert.equal(moved.body.instrumentId, ids.guitar);
        assert.equal(moved.body.level, '2');
    });

    test('no se le quita a un profesor un instrumento que tienen sus estudiantes', async () => {
        const blocked = await call('PUT', `/academy/teachers/${ids.andres}/instruments`, 'academy', { instrumentIds: [ids.piano] });
        assert.equal(blocked.status, 409);

        const ok = await call('PUT', `/academy/teachers/${ids.laura}/instruments`, 'academy', { instrumentIds: [ids.piano, ids.guitar] });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.instrumentIds.length, 2);
    });

    test('un instrumento inactivo no se ofrece ni se asigna', async () => {
        const res = await call('PUT', `/instruments/${ids.guitar}`, 'academy', { active: false });
        assert.equal(res.body.active, false);
        assert.deepEqual((await call('GET', '/instruments', 'academy')).body.map(i => i.name), ['Piano']);
        assert.equal((await call('GET', '/instruments?all=1', 'academy')).body.length, 2);

        const res2 = await call('POST', '/students', 'academy', { name: 'Ana', email: 'ana@test.co', teacherId: ids.andres, instrumentId: ids.guitar });
        assert.equal(res2.status, 400);
        assert.equal(res2.body.code, 'instrumento_invalido');
    });
});
