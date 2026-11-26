const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { STANDARD_LEVELS } = require('../domain/levels');

const PASSWORD = 'clave-de-prueba-1';
const pieces = ['A', 'B', 'C'].map(category => ({ category, title: `Obra ${category}` }));

describe('Niveles propios de cada instrumento', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const ladder = async (instrumentId) => (await call('GET', `/instruments/${instrumentId}/levels`, 'academy')).body.levels;

    before(async () => {
        models = await setupDatabase();
        const { User } = models;
        await User.create({ name: 'Academia', email: 'academia@test.co', password: PASSWORD, role: 'academy' });
        server = await startServer();
        tokens.academy = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email: 'academia@test.co', password: PASSWORD } })).body.token;
        ids.piano = (await models.Instrument.findOne({ where: { name: 'Piano' } })).id;
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('la migración y cada instrumento nuevo arrancan con la escala estándar', async () => {
        assert.deepEqual(await ladder(ids.piano), STANDARD_LEVELS);
        const violin = await call('POST', '/instruments', 'academy', { name: 'Violín' });
        ids.violin = violin.body.id;
        assert.deepEqual(await ladder(ids.violin), STANDARD_LEVELS);
        const listed = (await call('GET', '/instruments', 'academy')).body.find(i => i.id === ids.violin);
        assert.deepEqual(listed.levels, STANDARD_LEVELS);
    });

    test('agregar, ordenar y validar nombres', async () => {
        const added = await call('POST', `/instruments/${ids.violin}/levels`, 'academy', { name: '  Pre   inicial ', position: 0 });
        assert.equal(added.status, 201);
        assert.equal(added.body.levels[0], 'Pre inicial');
        assert.equal((await call('POST', `/instruments/${ids.violin}/levels`, 'academy', { name: 'inicial' })).body.code, 'nivel_repetido');
        assert.equal((await call('POST', `/instruments/${ids.violin}/levels`, 'academy', { name: ' ' })).body.code, 'nombre_requerido');

        const current = await ladder(ids.violin);
        const reversed = [...current].reverse();
        assert.deepEqual((await call('PUT', `/instruments/${ids.violin}/levels/order`, 'academy', { names: reversed })).body.levels, reversed);
        assert.equal((await call('PUT', `/instruments/${ids.violin}/levels/order`, 'academy', { names: reversed.slice(1) })).body.code, 'orden_invalido');
        await call('PUT', `/instruments/${ids.violin}/levels/order`, 'academy', { names: current });

        // Piano keeps its own ladder
        assert.deepEqual(await ladder(ids.piano), STANDARD_LEVELS);
    });

    test('el estudiante arranca en el primer nivel de su instrumento y solo usa niveles de ese instrumento', async () => {
        const teacher = await call('POST', '/academy/teachers', 'academy', { name: 'Laura', email: 'laura@test.co', password: PASSWORD, instrumentIds: [ids.piano, ids.violin] });
        ids.laura = teacher.body.id;
        tokens.laura = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email: 'laura@test.co', password: PASSWORD } })).body.token;

        const ana = await call('POST', '/students', 'academy', { name: 'Ana', email: 'ana@test.co', teacherId: ids.laura, instrumentId: ids.violin });
        assert.equal(ana.status, 201, ana.body?.message);
        assert.equal(ana.body.student.level, 'Pre inicial');
        ids.ana = ana.body.student.id;

        // "Pre inicial" is not a piano level
        const toPiano = await call('PUT', `/students/${ids.ana}`, 'academy', { instrumentId: ids.piano });
        assert.equal(toPiano.body.code, 'nivel_invalido');
        assert.equal((await call('PUT', `/students/${ids.ana}`, 'academy', { instrumentId: ids.piano, level: '2' })).status, 200);
        await call('PUT', `/students/${ids.ana}`, 'academy', { instrumentId: ids.violin, level: '2' });
    });

    test('renombrar un nivel lo cambia en estudiantes, requisitos y solicitudes', async () => {
        await call('PUT', `/level-guide/${ids.violin}/2`, 'academy', { description: 'Escalas en tercera posición' });
        const requested = await call('POST', '/level-requests', 'laura', { studentId: ids.ana, modality: 'muestra', toLevel: '3', pieces });
        assert.equal(requested.status, 201, requested.body?.message);

        const renamed = await call('PUT', `/instruments/${ids.violin}/levels/rename`, 'academy', { from: '2', to: 'Intermedio' });
        assert.ok(renamed.body.levels.includes('Intermedio'));
        await call('PUT', `/instruments/${ids.violin}/levels/rename`, 'academy', { from: '3', to: 'Avanzado' });

        assert.equal((await models.User.findByPk(ids.ana)).level, 'Intermedio');
        const guide = (await call('GET', `/level-guide/${ids.violin}`, 'academy')).body;
        assert.equal(guide.levels.find(l => l.level === 'Intermedio').description, 'Escalas en tercera posición');
        const request = await models.LevelRequest.findByPk(requested.body.id);
        assert.equal(request.fromLevel, 'Intermedio');
        assert.equal(request.toLevel, 'Avanzado');
        assert.equal((await call('PUT', `/instruments/${ids.violin}/levels/rename`, 'academy', { from: 'Avanzado', to: 'intermedio' })).body.code, 'nivel_repetido');

        // Piano's "2" is untouched
        assert.ok((await ladder(ids.piano)).includes('2'));
    });

    test('no se borra un nivel con estudiantes o con un ascenso abierto', async () => {
        assert.equal((await call('DELETE', `/instruments/${ids.violin}/levels/Intermedio`, 'academy')).body.code, 'nivel_en_uso');
        assert.equal((await call('DELETE', `/instruments/${ids.violin}/levels/Avanzado`, 'academy')).body.code, 'nivel_en_uso');

        const free = await call('DELETE', `/instruments/${ids.violin}/levels/${encodeURIComponent('Pre inicial')}`, 'academy');
        assert.equal(free.status, 200);
        assert.ok(!free.body.levels.includes('Pre inicial'));
    });

    test('la aprobación usa el orden de la escala del instrumento', async () => {
        const request = await models.LevelRequest.findOne({ where: { studentId: ids.ana } });
        await call('POST', `/level-requests/${request.id}/schedule`, 'academy', { showcaseAt: new Date().toISOString(), showcasePlace: 'Auditorio' });
        const approved = await call('POST', `/level-requests/${request.id}/approve`, 'academy', {});
        assert.equal(approved.status, 200, approved.body?.message);
        assert.equal((await models.User.findByPk(ids.ana)).level, 'Avanzado');

        // Moving "Avanzado" below "Intermedio" makes "Intermedio" a higher level
        const levels = await ladder(ids.violin);
        const swapped = levels.map(l => (l === 'Avanzado' ? 'Intermedio' : l === 'Intermedio' ? 'Avanzado' : l));
        await call('PUT', `/instruments/${ids.violin}/levels/order`, 'academy', { names: swapped });
        const up = await call('POST', '/level-requests', 'laura', { studentId: ids.ana, modality: 'muestra', toLevel: 'Intermedio', pieces });
        assert.equal(up.status, 201, up.body?.message);
    });
});
