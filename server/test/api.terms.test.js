// Terms and conditions: a new student cannot use the app until they accept;
// current students can postpone until the deadline but cannot book; each
// acceptance records date, time and version; a new version asks again.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { termsStatus } = require('../domain/terms');

const PASSWORD = 'clave-de-prueba-1';
const TEXT = 'Términos y condiciones de la academia: cancelaciones con 12 horas, pago del 1 al 5 de cada mes.';

test('reglas: alumno nuevo bloqueado; alumno actual pospone hasta la fecha; después, bloqueado', () => {
    const version = { id: 'v1', version: 1, acceptBy: '2026-12-31', createdAt: '2026-11-25T12:00:00Z' };
    const existing = termsStatus({ version, acceptance: null, accountCreatedAt: '2026-10-01T12:00:00Z', today: '2026-12-15' });
    assert.equal(existing.required, true);
    assert.equal(existing.blocking, false);
    assert.equal(existing.canPostpone, true);
    assert.match(existing.message, /a más tardar el jueves 31 de diciembre/);

    const late = termsStatus({ version, acceptance: null, accountCreatedAt: '2026-10-01T12:00:00Z', today: '2027-01-01' });
    assert.equal(late.blocking, true);
    assert.match(late.message, /venció el jueves 31 de diciembre/);

    const newStudent = termsStatus({ version, acceptance: null, accountCreatedAt: '2026-12-01T12:00:00Z', today: '2026-12-02' });
    assert.equal(newStudent.blocking, true);

    const accepted = termsStatus({ version, acceptance: { termsVersionId: 'v1', acceptedAt: '2026-12-02T15:00:00Z' }, accountCreatedAt: '2026-10-01', today: '2026-12-02' });
    assert.equal(accepted.required, false);

    // A new version without deadline: who accepted the old one can keep using the app but not book
    const v2 = { id: 'v2', version: 2, acceptBy: null, createdAt: '2027-03-01T12:00:00Z' };
    const changed = termsStatus({ version: v2, acceptance: { termsVersionId: 'v1' }, accountCreatedAt: '2026-10-01', today: '2027-03-02' });
    assert.equal(changed.required, true);
    assert.equal(changed.blocking, false);
    assert.equal(changed.schedulingBlocked, true);

    assert.deepEqual(termsStatus({ version: null, acceptance: null, accountCreatedAt: '2026-10-01', today: '2026-12-02' }), { required: false });
});

describe('API de términos y condiciones', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const login = async (role, email) => {
        tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } })).body.token;
    };

    before(async () => {
        models = await setupDatabase();
        const { User } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.actual = (await create({ name: 'Alumna actual', email: 'actual@test.co', role: 'student', teacherId: ids.laura })).id;
        server = await startServer();
        await login('academy', 'academia@test.co');
        await login('laura', 'laura@test.co');
        await login('actual', 'actual@test.co');
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('sin términos publicados no se pide nada', async () => {
        const res = await call('GET', '/terms/current', 'actual');
        assert.equal(res.body.version, null);
        assert.equal(res.body.status.required, false);
    });

    test('solo la academia publica; el texto queda como versión 1 y no se edita', async () => {
        assert.equal((await call('POST', '/terms', 'laura', { content: TEXT })).status, 403);
        assert.equal((await call('POST', '/terms', 'academy', { content: 'corto' })).status, 400);
        const v1 = await call('POST', '/terms', 'academy', { content: TEXT, acceptBy: '2099-12-31' });
        assert.equal(v1.status, 201, v1.body.message);
        assert.equal(v1.body.version, 1);
        ids.v1 = v1.body.id;
        const row = await models.TermsVersion.findByPk(ids.v1);
        await assert.rejects(row.update({ content: 'otro' }), { code: 'terminos_inmutables' });
    });

    test('la alumna actual puede seguir usando la app, pero no cambiar clases, hasta aceptar', async () => {
        const status = (await call('GET', '/terms/current', 'actual')).body.status;
        assert.equal(status.required, true);
        assert.equal(status.canPostpone, true);
        assert.equal((await call('GET', '/students/me/overview', 'actual')).status, 200);
        // The teacher does not accept terms
        assert.equal((await call('GET', '/terms/current', 'laura')).body.status.required, false);
    });

    test('una alumna nueva no puede usar la app hasta aceptar; al aceptar queda registro de fecha, hora y versión', async () => {
        ids.nueva = (await models.User.create({ password: PASSWORD, name: 'Nueva', email: 'nueva@test.co', role: 'student', teacherId: ids.laura })).id;
        await login('nueva', 'nueva@test.co');

        const blocked = await call('GET', '/students/me/overview', 'nueva');
        assert.equal(blocked.status, 403);
        assert.equal(blocked.body.code, 'terminos_requeridos');
        assert.match(blocked.body.message, /lee y acepta los términos/);
        // Reading the terms and the profile still works
        assert.equal((await call('GET', '/terms/current', 'nueva')).body.version.content, TEXT);
        assert.equal((await call('GET', '/users/me', 'nueva')).status, 200);

        const accepted = await call('POST', '/terms/accept', 'nueva', { versionId: ids.v1 });
        assert.equal(accepted.status, 200, accepted.body.message);
        assert.equal(accepted.body.status.required, false);
        const record = await models.TermsAcceptance.findOne({ where: { userId: ids.nueva } });
        assert.equal(record.version, 1);
        assert.ok(record.acceptedAt);
        assert.equal((await call('GET', '/students/me/overview', 'nueva')).status, 200);
    });

    test('al publicar una versión nueva, se pide aceptar otra vez; aceptar una versión vieja falla', async () => {
        const v2 = await call('POST', '/terms', 'academy', { content: `${TEXT} Versión 2.` });
        assert.equal(v2.body.version, 2);
        const status = (await call('GET', '/terms/current', 'nueva')).body.status;
        assert.equal(status.required, true);
        assert.equal(status.blocking, false);
        const old = await call('POST', '/terms/accept', 'nueva', { versionId: ids.v1 });
        assert.equal(old.status, 409);
        assert.equal((await call('POST', '/terms/accept', 'nueva', { versionId: v2.body.id })).body.status.required, false);

        const overview = await call('GET', '/terms', 'academy');
        assert.equal(overview.body.current.version, 2);
        const nueva = overview.body.students.find(s => s.id === ids.nueva);
        assert.ok(nueva.acceptedAt);
        assert.equal(overview.body.students.find(s => s.id === ids.actual).acceptedAt, null);
    });
});
