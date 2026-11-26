const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { isReader, normalizeAnnouncement } = require('../domain/announcements');
const { localDate, addDays } = require('../domain/time');

const PASSWORD = 'clave-de-prueba-1';

describe('Avisos: anuncios con audiencia y caducidad', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const feed = async (role) => (await call('GET', '/notices/feed', role)).body;
    const titles = (list) => list.map(a => a.title).sort();
    const today = localDate(new Date());

    before(async () => {
        models = await setupDatabase();
        const { User } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.andres = (await create({ name: 'Andrés', email: 'andres@test.co', role: 'teacher' })).id;
        ids.sofia = (await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.tomas = (await create({ name: 'Tomás', email: 'tomas@test.co', role: 'student', teacherId: ids.andres })).id;

        server = await startServer();
        for (const role of ['academia', 'laura', 'andres', 'sofia', 'tomas']) {
            tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email: `${role}@test.co`, password: PASSWORD } })).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('reglas de audiencia y validación', () => {
        const student = { id: 's', role: 'student', teacherId: 't1' };
        const teacher = { id: 't1', role: 'teacher' };
        assert.equal(isReader(student, { audience: 'todos' }), true);
        assert.equal(isReader(student, { audience: 'profesores' }), false);
        assert.equal(isReader(student, { audience: 'mis_estudiantes', teacherId: 't1' }), true);
        assert.equal(isReader(student, { audience: 'mis_estudiantes', teacherId: 't2' }), false);
        assert.equal(isReader(teacher, { audience: 'profesores' }), true);
        assert.equal(isReader(teacher, { audience: 'estudiantes' }), false);

        const base = { actor: teacher, today: '2026-11-02', defaultDays: 15, creating: true };
        const ok = normalizeAnnouncement({ title: ' Recital ', content: 'El sábado', audience: 'todos' }, base);
        assert.deepEqual(ok.values, { title: 'Recital', content: 'El sábado', visibleUntil: '2026-11-17', audience: 'mis_estudiantes' });
        assert.equal(normalizeAnnouncement({ title: 'x', content: 'y', visibleUntil: '2026-11-01' }, base).code, 'fecha_pasada');
        assert.equal(normalizeAnnouncement({ title: '', content: 'y' }, base).code, 'titulo_requerido');
        assert.equal(normalizeAnnouncement({ title: 'x', content: 'y', audience: 'mis_estudiantes' }, { ...base, actor: { role: 'academy' } }).code, 'audiencia_invalida');
    });

    test('cada quien ve solo los anuncios que le corresponden', async () => {
        const post = (role, body) => call('POST', '/announcements', role, body);
        assert.equal((await post('academia', { title: 'Cierre por festivo', content: 'Lunes cerrado', audience: 'todos' })).status, 201);
        await post('academia', { title: 'Reunión de profesores', content: 'Viernes 6 p. m.', audience: 'profesores' });
        await post('academia', { title: 'Recital de estudiantes', content: 'Inscríbanse', audience: 'estudiantes' });
        const laura = await post('laura', { title: 'Tarea de Laura', content: 'Escalas', audience: 'todos' });
        assert.equal(laura.body.audience, 'mis_estudiantes');
        ids.lauraPost = laura.body.id;
        assert.equal((await post('sofia', { title: 'x', content: 'y' })).status, 403);

        assert.deepEqual(titles((await feed('sofia')).announcements), ['Cierre por festivo', 'Recital de estudiantes', 'Tarea de Laura']);
        assert.deepEqual(titles((await feed('tomas')).announcements), ['Cierre por festivo', 'Recital de estudiantes']);
        assert.deepEqual(titles((await feed('laura')).announcements), ['Cierre por festivo', 'Reunión de profesores']);

        // Authors manage their own; the academy manages all
        assert.equal((await call('GET', '/announcements', 'laura')).body.length, 1);
        assert.equal((await call('GET', '/announcements', 'academia')).body.length, 4);
        assert.equal((await call('DELETE', `/announcements/${ids.lauraPost}`, 'andres')).status, 403);
    });

    test('marcar como leídos cuenta anuncios y notificaciones', async () => {
        await models.Notice.create({ kind: 'sistema', title: 'Clase cancelada', message: 'x' }).then(n =>
            models.NoticeRecipient.create({ noticeId: n.id, userId: ids.sofia }));
        let sofia = await feed('sofia');
        assert.equal(sofia.unread, 4);

        await call('POST', '/notices/read', 'sofia', { announcementIds: [ids.lauraPost] });
        assert.equal((await feed('sofia')).unread, 3);

        await call('POST', '/notices/read', 'sofia', {});
        sofia = await feed('sofia');
        assert.equal(sofia.unread, 0);
        assert.ok(sofia.announcements.every(a => a.readAt));

        const managed = (await call('GET', '/announcements', 'laura')).body[0];
        assert.equal(managed.readCount, 1);
    });

    test('los anuncios vencidos y los avisos leídos viejos salen de la tarjeta pero quedan en el historial', async () => {
        await call('POST', `/announcements/${ids.lauraPost}/end`, 'laura');
        assert.ok(!titles((await feed('sofia')).announcements).includes('Tarea de Laura'));
        const history = (await call('GET', '/notices/history', 'sofia')).body;
        const ended = history.announcements.find(a => a.title === 'Tarea de Laura');
        assert.equal(ended.current, false);

        // A notice read and 20 days old leaves the card (default: 14 days)
        const old = await models.Notice.create({ kind: 'sistema', title: 'Pago confirmado', message: 'viejo' });
        const recipient = await models.NoticeRecipient.create({ noticeId: old.id, userId: ids.sofia, readAt: new Date() });
        const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        await models.sequelize.query('UPDATE NoticeRecipients SET createdAt = :at WHERE id = :id', { replacements: { at: twentyDaysAgo, id: recipient.id } });
        assert.ok(!(await feed('sofia')).notifications.some(n => n.title === 'Pago confirmado'));
        assert.ok((await call('GET', '/notices/history', 'sofia')).body.notifications.some(n => n.title === 'Pago confirmado'));
    });

    test('vigencia: por defecto según Ajustes, editable y nunca en el pasado', async () => {
        await call('PUT', '/settings', 'academia', { dias_vigencia_anuncio: 3 });
        const res = await call('POST', '/announcements', 'andres', { title: 'Corto', content: 'Tres días' });
        assert.equal(res.body.visibleUntil, addDays(today, 3));

        const past = await call('PUT', `/announcements/${res.body.id}`, 'andres', { visibleUntil: addDays(today, -2) });
        assert.equal(past.body.code, 'fecha_pasada');
        const longer = await call('PUT', `/announcements/${res.body.id}`, 'andres', { visibleUntil: addDays(today, 30), audience: 'todos' });
        assert.equal(longer.body.visibleUntil, addDays(today, 30));
        assert.equal(longer.body.audience, 'mis_estudiantes');

        assert.equal((await call('DELETE', `/announcements/${res.body.id}`, 'academia')).status, 200);
        assert.equal(await models.Announcement.count({ where: { id: res.body.id } }), 0);
    });
});
