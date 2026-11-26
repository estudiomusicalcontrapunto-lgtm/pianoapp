const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { computeStreak, currentStreak, weekStartOf } = require('../domain/practice');
const { markPracticeToday, getPracticeWeek } = require('../services/practiceService');
const { localDate, toUtc } = require('../domain/time');

const PASSWORD = 'clave-de-prueba-1';

describe('Racha de estudio: días practicados por semana', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });

    before(async () => {
        models = await setupDatabase();
        const { User } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.pedro = (await create({ name: 'Pedro', email: 'pedro@test.co', role: 'teacher' })).id;
        ids.sofia = (await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.tomas = (await create({ name: 'Tomás', email: 'tomas@test.co', role: 'student', teacherId: ids.laura })).id;
        server = await startServer();
        for (const role of ['academia', 'laura', 'pedro', 'sofia']) {
            tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email: `${role}@test.co`, password: PASSWORD } })).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('la racha cuenta días seguidos y no se pierde hasta que termina el día', () => {
        assert.equal(computeStreak(['2026-11-01', '2026-11-02', '2026-11-03'], '2026-11-03'), 3);
        // Today not marked yet: the streak up to yesterday still counts
        assert.equal(computeStreak(['2026-11-01', '2026-11-02'], '2026-11-03'), 2);
        // A whole day without practice resets it
        assert.equal(computeStreak(['2026-10-30', '2026-11-01'], '2026-11-03'), 0);
        assert.equal(computeStreak(['2026-10-31', '2026-11-02', '2026-11-03'], '2026-11-03'), 2);
        // Sunday counts like any other day
        assert.equal(computeStreak(['2026-10-31', '2026-11-02'], '2026-11-02'), 1);

        assert.equal(currentStreak({ streak: 5, lastPractice: '2026-11-02' }, '2026-11-03'), 5);
        assert.equal(currentStreak({ streak: 5, lastPractice: '2026-11-01' }, '2026-11-03'), 0);
        assert.equal(weekStartOf('2026-11-08'), '2026-11-02');
    });

    test('marcar práctica: solo el estudiante, una vez al día, con la fecha de Bogotá', async () => {
        assert.equal((await call('POST', '/users/practice', 'laura')).status, 403);

        const first = await call('POST', '/users/practice', 'sofia');
        assert.equal(first.status, 200, first.body?.message);
        assert.equal(first.body.streak, 1);
        assert.equal(first.body.lastPractice, localDate(new Date()));
        await call('POST', '/users/practice', 'sofia');
        assert.equal(await models.PracticeDay.count({ where: { studentId: ids.sofia } }), 1);

        // 10 p. m. in Bogotá is already the next day in UTC: it counts for the Bogotá day
        const night = new Date('2026-11-03T03:00:00.000Z');
        await markPracticeToday({ studentId: ids.tomas, now: night });
        assert.ok(await models.PracticeDay.findOne({ where: { studentId: ids.tomas, date: '2026-11-02' } }));
    });

    test('días seguidos suben la racha; un día sin práctica la reinicia', async () => {
        await models.PracticeDay.destroy({ where: { studentId: ids.tomas } });
        const at = (date) => toUtc(date, '18:00');
        for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) {
            await markPracticeToday({ studentId: ids.tomas, now: at(date) });
        }
        assert.equal((await models.User.findByPk(ids.tomas)).streak, 3);
        const restarted = await markPracticeToday({ studentId: ids.tomas, now: at('2026-11-06') });
        assert.equal(restarted.streak, 1);

        const tomas = await models.User.findByPk(ids.tomas);
        const week = await getPracticeWeek({ student: tomas, weekStart: '2026-11-04', now: at('2026-11-06') });
        assert.equal(week.weekStart, '2026-11-02');
        assert.deepEqual(week.days.filter(d => d.practiced).map(d => d.date), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06']);
        assert.equal(week.days.length, 7);
        assert.equal(week.streak, 1);
    });

    test('el profesor ve la semana de sus estudiantes; otro profesor no', async () => {
        const week = await call('GET', `/users/${ids.sofia}/practice`, 'laura');
        assert.equal(week.status, 200);
        assert.ok(week.body.days.find(d => d.date === localDate(new Date())).practiced);
        assert.equal((await call('GET', `/users/${ids.sofia}/practice`, 'pedro')).status, 403);
        assert.equal((await call('GET', `/users/${ids.sofia}/practice`, 'academia')).status, 200);
        assert.equal((await call('GET', `/users/${ids.sofia}/practice?weekStart=ayer`, 'sofia')).status, 400);

        const students = (await call('GET', '/users/students', 'laura')).body;
        assert.deepEqual(students.find(s => s.id === ids.sofia).practiceWeek, [localDate(new Date())]);
    });
});
