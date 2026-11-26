const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');

const PASSWORD = 'clave-de-prueba-1';

const pieces = (withVideos) => ['A', 'B', 'C'].map(category => ({
    category,
    title: `Obra ${category}`,
    composer: 'Bach',
    ...(withVideos && { videoUrl: `https://youtu.be/obra-${category}` }),
}));

describe('API: solicitudes de ascenso de nivel', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const levelOf = async (id) => (await models.User.findByPk(id)).level;
    const noticesOf = async (role) => (await call('GET', '/notices', role)).body;

    before(async () => {
        models = await setupDatabase();
        const { User } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.pedro = (await create({ name: 'Pedro', email: 'pedro@test.co', role: 'teacher' })).id;
        ids.sofia = (await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura, level: '2' })).id;
        ids.valen = (await create({ name: 'Valentina', email: 'valen@test.co', role: 'student', teacherId: ids.laura, level: '3' })).id;

        server = await startServer();
        for (const [role, email] of [['academy', 'academia@test.co'], ['laura', 'laura@test.co'], ['pedro', 'pedro@test.co'], ['sofia', 'sofia@test.co']]) {
            tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } })).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('el profesor ya no puede cambiar el nivel directamente', async () => {
        const res = await call('PUT', `/users/${ids.sofia}/promote`, 'laura', { level: '5' });
        assert.equal(res.status, 404);
        assert.equal(await levelOf(ids.sofia), '2');
    });

    test('valida obras, links, nivel y que el estudiante sea del profesor', async () => {
        const base = { studentId: ids.sofia, modality: 'videos', toLevel: '3', pieces: pieces(true) };

        let res = await call('POST', '/level-requests', 'laura', { ...base, pieces: pieces(true).slice(0, 2) });
        assert.equal(res.status, 400);
        assert.match(res.body.message, /categoría C/);

        res = await call('POST', '/level-requests', 'laura', { ...base, pieces: pieces(false) });
        assert.equal(res.status, 400);
        assert.equal(res.body.code, 'obras_invalidas');

        res = await call('POST', '/level-requests', 'laura', { ...base, pieces: pieces(true).map(p => ({ ...p, videoUrl: 'javascript:alert(1)' })) });
        assert.equal(res.status, 400);

        res = await call('POST', '/level-requests', 'laura', { ...base, toLevel: '2' });
        assert.equal(res.body.code, 'nivel_invalido');

        res = await call('POST', '/level-requests', 'pedro', base);
        assert.equal(res.status, 404);

        res = await call('POST', '/level-requests', 'sofia', base);
        assert.equal(res.status, 403);
    });

    test('por videos: la academia aprueba, el nivel cambia y se avisa', async () => {
        const created = await call('POST', '/level-requests', 'laura', {
            studentId: ids.sofia, modality: 'videos', toLevel: '4', pieces: pieces(true), notes: 'Lista para saltar un nivel',
        });
        assert.equal(created.status, 201, created.body.message);
        assert.equal(created.body.status, 'pendiente');
        assert.equal(created.body.fromLevel, '2');
        assert.equal(created.body.pieces[0].videoUrl, 'https://youtu.be/obra-A');
        ids.videoRequest = created.body.id;

        const academyNotice = (await noticesOf('academy')).find(n => n.category === 'ascenso_solicitado');
        assert.match(academyNotice.message, /Sofía/);

        // Only one open request per student
        const again = await call('POST', '/level-requests', 'laura', { studentId: ids.sofia, modality: 'muestra', toLevel: '3', pieces: pieces(false) });
        assert.equal(again.status, 409);

        // Videos cannot get a showcase
        const schedule = await call('POST', `/level-requests/${ids.videoRequest}/schedule`, 'academy', { showcaseAt: new Date().toISOString(), showcasePlace: 'Salón 1' });
        assert.equal(schedule.body.code, 'no_es_muestra');

        assert.equal((await call('POST', `/level-requests/${ids.videoRequest}/approve`, 'laura', {})).status, 403);

        const approved = await call('POST', `/level-requests/${ids.videoRequest}/approve`, 'academy', { note: 'Muy bien' });
        assert.equal(approved.status, 200, approved.body.message);
        assert.equal(approved.body.status, 'aprobada');
        assert.equal(await levelOf(ids.sofia), '4');

        assert.ok((await noticesOf('sofia')).some(n => n.category === 'ascenso_aprobado' && /Nivel 4/.test(n.message)));
        assert.ok((await noticesOf('laura')).some(n => n.category === 'ascenso_aprobado'));

        const twice = await call('POST', `/level-requests/${ids.videoRequest}/approve`, 'academy', {});
        assert.equal(twice.status, 409);
    });

    test('por muestra: hay que programarla antes de aprobar', async () => {
        const created = await call('POST', '/level-requests', 'laura', {
            studentId: ids.valen, modality: 'muestra', toLevel: '4',
            pieces: pieces(true), // links are dropped for a showcase
        });
        assert.equal(created.status, 201, created.body.message);
        assert.equal(created.body.pieces[1].videoUrl, null);
        const id = created.body.id;

        const early = await call('POST', `/level-requests/${id}/approve`, 'academy', {});
        assert.equal(early.body.code, 'muestra_sin_programar');

        const noPlace = await call('POST', `/level-requests/${id}/schedule`, 'academy', { showcaseAt: '2026-11-20T20:00:00.000Z' });
        assert.equal(noPlace.body.code, 'lugar_requerido');

        const scheduled = await call('POST', `/level-requests/${id}/schedule`, 'academy', { showcaseAt: '2026-11-20T20:00:00.000Z', showcasePlace: 'Auditorio' });
        assert.equal(scheduled.status, 200, scheduled.body.message);
        assert.equal(scheduled.body.status, 'muestra_programada');
        assert.equal(scheduled.body.showcasePlace, 'Auditorio');

        const approved = await call('POST', `/level-requests/${id}/approve`, 'academy', {});
        assert.equal(approved.status, 200, approved.body.message);
        assert.equal(await levelOf(ids.valen), '4');
    });

    test('rechazo con motivo y cancelación por el profesor', async () => {
        const first = await call('POST', '/level-requests', 'laura', { studentId: ids.sofia, modality: 'videos', toLevel: 'Prodigy', pieces: pieces(true) });
        assert.equal(first.status, 201, first.body.message);

        const noReason = await call('POST', `/level-requests/${first.body.id}/reject`, 'academy', { reason: ' ' });
        assert.equal(noReason.body.code, 'motivo_requerido');

        const rejected = await call('POST', `/level-requests/${first.body.id}/reject`, 'academy', { reason: 'Falta claridad en la obra B' });
        assert.equal(rejected.body.status, 'rechazada');
        assert.equal(await levelOf(ids.sofia), '4');
        assert.ok((await noticesOf('laura')).some(n => n.category === 'ascenso_rechazado' && /obra B/.test(n.message)));

        // After a rejection the teacher can try again, and withdraw it
        const second = await call('POST', '/level-requests', 'laura', { studentId: ids.sofia, modality: 'muestra', toLevel: '5', pieces: pieces(false) });
        assert.equal(second.status, 201, second.body.message);
        assert.equal((await call('POST', `/level-requests/${second.body.id}/cancel`, 'pedro')).status, 404);
        const cancelled = await call('POST', `/level-requests/${second.body.id}/cancel`, 'laura');
        assert.equal(cancelled.body.status, 'cancelada');
    });

    test('cada quien ve solo lo que le corresponde', async () => {
        const academy = await call('GET', '/level-requests', 'academy');
        assert.equal(academy.body.length, 4);
        assert.ok(academy.body.every(r => r.studentName && r.teacherName));

        assert.equal((await call('GET', '/level-requests', 'laura')).body.length, 4);
        assert.equal((await call('GET', '/level-requests', 'pedro')).body.length, 0);
        assert.equal((await call('GET', `/level-requests?studentId=${ids.valen}`, 'laura')).body.length, 1);
        assert.equal((await call('GET', '/level-requests?open=1', 'academy')).body.length, 0);
        assert.equal((await call('GET', '/level-requests', 'sofia')).status, 403);
    });
});
