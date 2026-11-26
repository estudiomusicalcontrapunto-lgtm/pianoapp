const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');

describe('API fase 1', () => {
let models;
let server;
const tokens = {};

const PASSWORD = 'clave-de-prueba-1';

const login = async (email) => {
    const res = await request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(res.status, 200, `login ${email}`);
    return res.body.token;
};

before(async () => {
    models = await setupDatabase();
    const { User } = models;
    const teacher = await User.create({ name: 'Profe', email: 'profe@test.co', password: PASSWORD, role: 'teacher' });
    await User.create({ name: 'Academia', email: 'academia@test.co', password: PASSWORD, role: 'academy' });
    await User.create({ name: 'Ana', email: 'ana@test.co', password: PASSWORD, role: 'student', teacherId: teacher.id });
    await User.create({ name: 'Inactivo', email: 'inactivo@test.co', password: PASSWORD, role: 'student', active: false });

    server = await startServer();
    tokens.academy = await login('academia@test.co');
    tokens.teacher = await login('profe@test.co');
    tokens.student = await login('ana@test.co');
});

after(async () => {
    await server.close();
    await teardownDatabase();
});

test('ya no existe el registro público', async () => {
    const res = await request(server.baseUrl, 'POST', '/auth/register', {
        body: { name: 'X', email: 'x@test.co', password: PASSWORD, role: 'student', classCode: '123456' },
    });
    assert.equal(res.status, 404);
});

test('una cuenta desactivada no puede iniciar sesión', async () => {
    const res = await request(server.baseUrl, 'POST', '/auth/login', { body: { email: 'inactivo@test.co', password: PASSWORD } });
    assert.equal(res.status, 403);
});

test('todos los roles leen los ajustes, con los valores por defecto', async () => {
    const res = await request(server.baseUrl, 'GET', '/settings', { token: tokens.student });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.horas_minimas_aviso, 12);
    assert.ok(res.body.definitions.length > 0);
});

test('solo la academia cambia los ajustes', async () => {
    for (const role of ['teacher', 'student']) {
        const res = await request(server.baseUrl, 'PUT', '/settings', { token: tokens[role], body: { horas_minimas_aviso: 1 } });
        assert.equal(res.status, 403, role);
    }
    const noToken = await request(server.baseUrl, 'PUT', '/settings', { body: { horas_minimas_aviso: 1 } });
    assert.equal(noToken.status, 401);
});

test('la academia cambia un ajuste y queda en la auditoría', async () => {
    const res = await request(server.baseUrl, 'PUT', '/settings', { token: tokens.academy, body: { horas_minimas_aviso: 10 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.horas_minimas_aviso, 10);

    const entry = await models.AuditLog.findOne({ where: { entityType: 'setting', entityId: 'horas_minimas_aviso' } });
    assert.equal(entry.fromStatus, '12');
    assert.equal(entry.toStatus, '10');
});

test('un ajuste inválido responde 400 sin guardar nada', async () => {
    const res = await request(server.baseUrl, 'PUT', '/settings', {
        token: tokens.academy,
        body: { precio_paquete_4: 'mucho', horas_cupo_apartado: 72 },
    });
    assert.equal(res.status, 400);
    const settings = await request(server.baseUrl, 'GET', '/settings', { token: tokens.academy });
    assert.equal(settings.body.settings.horas_cupo_apartado, 48);
});

test('la academia no tiene días de cierre: la opción ya no existe', async () => {
    const created = await request(server.baseUrl, 'POST', '/closures', {
        token: tokens.academy,
        body: { date: '2026-12-08', reason: 'Inmaculada Concepción' },
    });
    assert.equal(created.status, 404);
});

test('cambiar la contraseña exige la actual y quita el aviso de contraseña temporal', async () => {
    const { User } = models;
    await User.update({ mustChangePassword: true }, { where: { email: 'ana@test.co' } });

    const wrong = await request(server.baseUrl, 'POST', '/auth/change-password', {
        token: tokens.student,
        body: { currentPassword: 'otra', newPassword: 'nueva-clave-123' },
    });
    assert.equal(wrong.status, 400);

    const ok = await request(server.baseUrl, 'POST', '/auth/change-password', {
        token: tokens.student,
        body: { currentPassword: PASSWORD, newPassword: 'nueva-clave-123' },
    });
    assert.equal(ok.status, 200);
    const ana = await User.findOne({ where: { email: 'ana@test.co' } });
    assert.equal(ana.mustChangePassword, false);
});
});
