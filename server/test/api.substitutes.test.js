const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { localDate, addDays, weekdayOf, toUtc } = require('../domain/time');
const { findDatedConflict } = require('../domain/conflicts');
const { checkTeacherPresent, normalizeSubstitute } = require('../domain/absences');

const PASSWORD = 'clave-de-prueba-1';

describe('Reemplazos: ausencias del profesor y clases movidas', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const noticeTitles = async (role) => (await call('GET', '/notices', role)).body.map(n => n.title);

    // Next Monday at least two days away: the absence covers Monday and Tuesday
    let monday = addDays(localDate(new Date()), 2);
    while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
    const tuesday = addDays(monday, 1);
    const thursday = addDays(monday, 3);

    before(async () => {
        models = await setupDatabase();
        const { User, Room, TeacherRoom, Cycle, Lesson } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.andres = (await create({ name: 'Andrés', email: 'andres@test.co', role: 'teacher' })).id;
        ids.pedro = (await create({ name: 'Pedro', email: 'pedro@test.co', role: 'teacher' })).id;
        ids.sofia = (await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.tomas = (await create({ name: 'Tomás', email: 'tomas@test.co', role: 'student', teacherId: ids.andres })).id;
        ids.salon1 = (await Room.create({ name: 'Salón 1' })).id;
        ids.salon2 = (await Room.create({ name: 'Salón 2' })).id;
        await TeacherRoom.bulkCreate([{ teacherId: ids.laura, roomId: ids.salon1 }, { teacherId: ids.andres, roomId: ids.salon2 }]);

        const cycle = (studentId) => Cycle.create({
            studentId, startDate: localDate(new Date()), endDate: addDays(monday, 20), plan: 'paquete_4', classesIncluded: 4,
            amount: 260000, status: 'activo', paymentStatus: 'pagado',
        });
        const lesson = (cycleId, studentId, teacherId, roomId, date, time = '09:00') => Lesson.create({
            cycleId, studentId, teacherId, roomId, startsAt: toUtc(date, time), endsAt: toUtc(date, time === '09:00' ? '10:00' : '12:00'),
        }).then(l => l.id);
        const sofiaCycle = (await cycle(ids.sofia)).id;
        const tomasCycle = (await cycle(ids.tomas)).id;
        ids.monday = await lesson(sofiaCycle, ids.sofia, ids.laura, ids.salon1, monday);
        ids.tuesday = await lesson(sofiaCycle, ids.sofia, ids.laura, ids.salon1, tuesday);
        ids.thursday = await lesson(sofiaCycle, ids.sofia, ids.laura, ids.salon1, thursday);
        // Andrés teaches Tomás on Monday at the same time as Sofía's class
        ids.tomasMonday = await lesson(tomasCycle, ids.tomas, ids.andres, ids.salon2, monday);

        server = await startServer();
        for (const role of ['academia', 'laura', 'andres', 'pedro', 'sofia']) {
            tokens[role] = (await request(server.baseUrl, 'POST', '/auth/login', { body: { email: `${role}@test.co`, password: PASSWORD } })).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('reglas: el reemplazo ocupa su tiempo y no se agenda en días de ausencia', () => {
        const lesson = { id: 'l1', startsAt: toUtc(monday, '09:00'), endsAt: toUtc(monday, '10:00'), teacherId: 'a', substituteTeacherId: 'b', status: 'programada' };
        const conflict = findDatedConflict({ startsAt: toUtc(monday, '09:30'), endsAt: toUtc(monday, '10:30'), teacherId: 'b' }, { lessons: [lesson] });
        assert.equal(conflict.type, 'profesor');

        const absences = [{ teacherId: 'a', startDate: monday, endDate: tuesday }];
        assert.equal(checkTeacherPresent({ absences, teacherId: 'a', startsAt: toUtc(tuesday, '15:00') }).code, 'profesor_ausente');
        assert.equal(checkTeacherPresent({ absences, teacherId: 'a', startsAt: toUtc(thursday, '15:00') }).ok, true);

        assert.equal(normalizeSubstitute({ name: ' ' }).code, 'reemplazo_requerido');
        assert.deepEqual(normalizeSubstitute({ name: ' Marta ', phone: '300' }).fields, { substituteTeacherId: null, substituteName: 'Marta', substitutePhone: '300' });
    });

    test('la academia registra la ausencia; valida fechas y solapes', async () => {
        assert.equal((await call('POST', '/substitutions/absences', 'laura', { teacherId: ids.laura, startDate: monday, endDate: tuesday })).status, 403);
        const backwards = await call('POST', '/substitutions/absences', 'academia', { teacherId: ids.laura, startDate: tuesday, endDate: monday });
        assert.equal(backwards.body.code, 'fechas_invertidas');

        const res = await call('POST', '/substitutions/absences', 'academia', { teacherId: ids.laura, startDate: monday, endDate: tuesday, reason: 'Congreso' });
        assert.equal(res.status, 201, res.body?.message);
        ids.absence = res.body.id;
        const again = await call('POST', '/substitutions/absences', 'academia', { teacherId: ids.laura, startDate: tuesday, endDate: thursday });
        assert.equal(again.body.code, 'ausencia_repetida');

        const list = (await call('GET', '/substitutions/absences', 'academia')).body;
        assert.equal(list[0].summary.uncovered, 2);
    });

    test('el detalle propone profesores libres a la hora de cada clase', async () => {
        const detail = (await call('GET', `/substitutions/absences/${ids.absence}`, 'academia')).body;
        assert.deepEqual(detail.lessons.map(l => l.id), [ids.monday, ids.tuesday]);
        const candidate = (lessonId, teacherId) => detail.lessons.find(l => l.id === lessonId).candidates.find(c => c.id === teacherId);
        assert.equal(candidate(ids.monday, ids.andres).free, false);
        assert.equal(candidate(ids.tuesday, ids.andres).free, true);
        assert.equal(candidate(ids.monday, ids.pedro).free, true);
        assert.ok(!detail.lessons[0].candidates.some(c => c.id === ids.laura));
    });

    test('asignar reemplazos: todo o nada, con aviso al estudiante y al reemplazo', async () => {
        const busy = await call('POST', '/substitutions/assign', 'academia', { lessonIds: [ids.monday, ids.tuesday], substitute: { teacherId: ids.andres } });
        assert.equal(busy.status, 409);
        assert.equal(busy.body.code, 'choque_profesor');
        assert.equal((await models.Lesson.findByPk(ids.tuesday)).substituteTeacherId, null);

        const ok = await call('POST', '/substitutions/assign', 'academia', { lessonIds: [ids.tuesday], substitute: { teacherId: ids.andres } });
        assert.equal(ok.status, 200, ok.body?.message);
        const external = await call('POST', '/substitutions/assign', 'academia', { lessonIds: [ids.monday], substitute: { name: 'Marta Ruiz', phone: '3001112233' } });
        assert.equal(external.status, 200);

        assert.ok((await noticeTitles('sofia')).includes('Clase con reemplazo'));
        assert.ok((await noticeTitles('andres')).includes('Te asignaron un reemplazo'));
        const summary = (await call('GET', '/substitutions/absences', 'academia')).body[0].summary;
        assert.equal(summary.covered, 2);
        assert.equal(summary.uncovered, 0);
    });

    test('el reemplazo ve la clase y puede tomar asistencia; otro profesor no', async () => {
        const lessons = (await call('GET', '/lessons', 'andres')).body;
        const covered = lessons.find(l => l.id === ids.tuesday);
        assert.equal(covered.substituteLabel, 'Andrés');
        assert.equal(covered.teacherName, 'Laura');

        // Permission passes; it is only too early to mark it
        assert.equal((await call('POST', `/lessons/${ids.tuesday}/attendance`, 'andres', { status: 'tomada' })).body.code, 'clase_futura');
        assert.equal((await call('POST', `/lessons/${ids.tuesday}/attendance`, 'pedro', { status: 'tomada' })).status, 403);

        const sofia = (await call('GET', '/lessons', 'sofia')).body.find(l => l.id === ids.monday);
        assert.equal(sofia.substituteLabel, 'Marta Ruiz');
    });

    test('el estudiante no puede reprogramar una clase con reemplazo', async () => {
        const options = (await call('GET', `/lessons/${ids.monday}/reschedule-options`, 'sofia')).body;
        assert.equal(options.rule.code, 'clase_con_reemplazo');
        assert.deepEqual(options.options, []);

        const window = await models.Availability.create({ teacherId: ids.laura, roomId: ids.salon1, weekday: 4, startTime: '15:00', endTime: '17:00', type: 'reposicion' });
        const res = await call('POST', `/lessons/${ids.monday}/reschedule`, 'sofia', { availabilityId: window.id, startsAt: toUtc(thursday, '15:00').toISOString() });
        assert.equal(res.body.code, 'clase_con_reemplazo');
        assert.equal((await models.Lesson.findByPk(ids.monday)).status, 'programada');
        await window.destroy();

        const overview = (await call('GET', '/students/me/overview', 'sofia')).body;
        assert.equal(overview.nextLesson.rule.code, 'clase_con_reemplazo');
    });

    test('quitar el reemplazo y cancelar las clases sin cubrir', async () => {
        const removed = await call('POST', '/substitutions/remove', 'academia', { lessonIds: [ids.tuesday] });
        assert.equal(removed.body.released, 1);
        assert.ok((await noticeTitles('andres')).includes('Reemplazo cancelado'));
        assert.ok((await noticeTitles('sofia')).includes('Vuelve tu profesor'));

        const cancelled = await call('POST', `/substitutions/absences/${ids.absence}/cancel-uncovered`, 'academia', {});
        assert.deepEqual(cancelled.body.map(l => l.id), [ids.tuesday]);
        assert.equal((await models.Lesson.findByPk(ids.tuesday)).status, 'cancelada_por_academia');
        assert.equal((await models.Lesson.findByPk(ids.monday)).status, 'programada');
    });

    test('mover una clase no cuenta como cancelación y el reporte lo muestra', async () => {
        const blocked = await call('POST', `/lessons/${ids.thursday}/move`, 'laura', { startsAt: toUtc(tuesday, '15:00').toISOString() });
        assert.equal(blocked.body.code, 'profesor_ausente');

        const moved = await call('POST', `/lessons/${ids.thursday}/move`, 'laura', { startsAt: toUtc(thursday, '11:00').toISOString() });
        assert.equal(moved.status, 200, moved.body?.message);
        const original = await models.Lesson.findByPk(ids.thursday);
        assert.equal(original.moved, true);

        const again = await call('POST', `/lessons/${moved.body.makeup.id}/move`, 'laura', { startsAt: toUtc(thursday, '15:00').toISOString() });
        assert.equal(again.status, 200, again.body?.message);

        const report = (await call('GET', `/substitutions/report?month=${thursday.slice(0, 7)}`, 'academia')).body;
        const laura = report.moves.find(m => m.teacherName === 'Laura');
        assert.equal(laura.count, 2);
        assert.deepEqual(laura.lessons.map(l => l.time).sort(), [1, 2]);

        const given = (await call('GET', `/substitutions/report?month=${monday.slice(0, 7)}`, 'academia')).body.given;
        assert.ok(given.some(g => g.substitute === 'Marta Ruiz' && g.external && g.upcoming === 1));
    });

    test('borrar la ausencia devuelve las clases a su profesor', async () => {
        const res = await call('DELETE', `/substitutions/absences/${ids.absence}`, 'academia');
        assert.equal(res.body.released, 1);
        assert.equal((await models.Lesson.findByPk(ids.monday)).substituteName, null);
        assert.equal(await models.TeacherAbsence.count(), 0);
    });
});
