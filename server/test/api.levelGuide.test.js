const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupDatabase, teardownDatabase, startServer, request, upload, uploads } = require('./helpers');

const PASSWORD = 'clave-de-prueba-1';
const PDF = '%PDF-1.4\n% prueba de requisitos\n';

describe('API: grados (requisitos por instrumento y nivel)', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const levelOf = (guide, level) => guide.levels.find(l => l.level === level);

    before(async () => {
        models = await setupDatabase();
        const { User, Instrument, TeacherInstrument } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        ids.piano = (await Instrument.findOne({ where: { name: 'Piano' } })).id;
        ids.guitar = (await Instrument.create({ name: 'Guitarra' })).id;
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        await TeacherInstrument.create({ teacherId: ids.laura, instrumentId: ids.piano });
        await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura, instrumentId: ids.piano });

        server = await startServer();
        for (const [role, email] of [['academy', 'academia@test.co'], ['laura', 'laura@test.co'], ['sofia', 'sofia@test.co']]) {
            tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } })).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('la guía trae todos los niveles, de Inicial a Genius', async () => {
        const guide = await call('GET', `/level-guide/${ids.piano}`, 'academy');
        assert.equal(guide.status, 200);
        assert.equal(guide.body.instrument.name, 'Piano');
        assert.equal(guide.body.levels[0].level, 'Inicial');
        assert.equal(guide.body.levels.at(-1).level, 'Genius');
        assert.equal(levelOf(guide.body, '1').description, '');
    });

    test('la academia escribe y borra los requisitos; nadie más puede', async () => {
        const saved = await call('PUT', `/level-guide/${ids.piano}/1`, 'academy', { description: '  Escalas mayores hasta 2 alteraciones.  ' });
        assert.equal(saved.status, 200);
        assert.equal(saved.body.description, 'Escalas mayores hasta 2 alteraciones.');
        await call('PUT', `/level-guide/${ids.piano}/1`, 'academy', { description: 'Escalas mayores y menores.' });
        assert.equal(levelOf((await call('GET', `/level-guide/${ids.piano}`, 'sofia')).body, '1').description, 'Escalas mayores y menores.');

        assert.equal((await call('PUT', `/level-guide/${ids.piano}/1`, 'laura', { description: 'x' })).status, 403);
        assert.equal((await call('PUT', `/level-guide/${ids.piano}/Experto`, 'academy', { description: 'x' })).status, 400);

        await call('PUT', `/level-guide/${ids.piano}/2`, 'academy', { description: 'Temporal' });
        await call('PUT', `/level-guide/${ids.piano}/2`, 'academy', { description: ' ' });
        assert.equal(await models.LevelRequirement.count({ where: { instrumentId: ids.piano, level: '2' } }), 0);
    });

    test('enlaces: solo http(s) y con título', async () => {
        const bad = await call('POST', `/level-guide/${ids.piano}/1/links`, 'academy', { title: 'Video', url: 'javascript:alert(1)' });
        assert.equal(bad.body.code, 'enlace_invalido');
        const noTitle = await call('POST', `/level-guide/${ids.piano}/1/links`, 'academy', { title: ' ', url: 'https://youtu.be/x' });
        assert.equal(noTitle.body.code, 'titulo_requerido');

        const ok = await call('POST', `/level-guide/${ids.piano}/1/links`, 'academy', { title: 'Escalas en video', url: 'https://youtu.be/escalas' });
        assert.equal(ok.status, 201);
        assert.equal(ok.body.kind, 'enlace');
    });

    test('PDF: se sube privado, lo abren quienes ven el instrumento y se borra con el adjunto', async () => {
        const forbidden = await upload(server.baseUrl, `/level-guide/${ids.piano}/1/files`, {
            token: tokens.laura, field: 'file', filename: 'requisitos.pdf', type: 'application/pdf', content: PDF,
        });
        assert.equal(forbidden.status, 403);

        const fake = await upload(server.baseUrl, `/level-guide/${ids.piano}/1/files`, {
            token: tokens.academy, field: 'file', filename: 'virus.pdf', type: 'application/pdf', content: 'MZ no soy un pdf',
        });
        assert.equal(fake.status, 400);
        const notPdf = await upload(server.baseUrl, `/level-guide/${ids.piano}/1/files`, {
            token: tokens.academy, field: 'file', filename: 'foto.png', type: 'image/png', content: 'png',
        });
        assert.equal(notPdf.status, 400);

        const res = await upload(server.baseUrl, `/level-guide/${ids.piano}/1/files`, {
            token: tokens.academy, field: 'file', filename: 'Requisitos nivel 1.pdf', type: 'application/pdf', content: PDF,
        });
        assert.equal(res.status, 201, res.body?.message);
        assert.equal(res.body.title, 'Requisitos nivel 1');
        assert.equal(res.body.filePath, undefined);
        ids.pdf = res.body.id;

        const stored = (await models.LevelResource.findByPk(ids.pdf)).filePath;
        assert.ok(fs.existsSync(path.join(uploads, stored)));

        for (const role of ['academy', 'laura', 'sofia']) {
            const file = await fetch(`${server.baseUrl}/level-guide/resources/${ids.pdf}/file`, { headers: { Authorization: `Bearer ${tokens[role]}` } });
            assert.equal(file.status, 200, role);
            assert.equal(await file.text(), PDF);
        }

        assert.equal((await call('DELETE', `/level-guide/resources/${ids.pdf}`, 'laura')).status, 403);
        assert.equal((await call('DELETE', `/level-guide/resources/${ids.pdf}`, 'academy')).status, 200);
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(fs.existsSync(path.join(uploads, stored)), false);
    });

    test('el profesor solo ve sus instrumentos y el estudiante solo el suyo', async () => {
        assert.equal((await call('GET', `/level-guide/${ids.guitar}`, 'laura')).status, 403);
        assert.equal((await call('GET', `/level-guide/${ids.guitar}`, 'sofia')).status, 403);
        assert.equal((await call('GET', `/level-guide/${ids.guitar}`, 'academy')).status, 200);

        const link = await call('POST', `/level-guide/${ids.guitar}/1/links`, 'academy', { title: 'Acordes', url: 'https://example.com/acordes' });
        const pdf = await upload(server.baseUrl, `/level-guide/${ids.guitar}/1/files`, {
            token: tokens.academy, field: 'file', filename: 'guitarra.pdf', type: 'application/pdf', content: PDF,
        });
        assert.equal(link.status, 201);
        const file = await fetch(`${server.baseUrl}/level-guide/resources/${pdf.body.id}/file`, { headers: { Authorization: `Bearer ${tokens.sofia}` } });
        assert.equal(file.status, 403);
    });
});
