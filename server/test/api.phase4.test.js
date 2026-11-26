const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase, startServer, request } = require('./helpers');
const { localDate, addDays, toUtc, localParts } = require('../domain/time');

const PASSWORD = 'clave-de-prueba-1';

// Next date (after today) with the given weekday, 1 = lunes
const nextWeekday = (weekday) => {
    let date = addDays(localDate(new Date()), 1);
    while (localParts(toUtc(date, '12:00')).weekday !== weekday) date = addDays(date, 1);
    return date;
};

describe('API fase 4: agenda del profesor', () => {
    let models;
    let server;
    const tokens = {};
    const ids = {};
    const call = (method, url, role, body) => request(server.baseUrl, method, url, { token: tokens[role], body });
    const login = (email) => request(server.baseUrl, 'POST', '/auth/login', { body: { email, password: PASSWORD } });

    before(async () => {
        models = await setupDatabase();
        const { User, Room, TeacherRoom } = models;
        const create = (data) => User.create({ password: PASSWORD, ...data });
        await create({ name: 'Academia', email: 'academia@test.co', role: 'academy' });
        ids.laura = (await create({ name: 'Laura', email: 'laura@test.co', role: 'teacher' })).id;
        ids.andres = (await create({ name: 'Andrés', email: 'andres@test.co', role: 'teacher' })).id;
        ids.sofia = (await create({ name: 'Sofía', email: 'sofia@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.tomas = (await create({ name: 'Tomás', email: 'tomas@test.co', role: 'student', teacherId: ids.andres })).id;
        ids.valen = (await create({ name: 'Valentina', email: 'valen@test.co', role: 'student', teacherId: ids.laura })).id;
        ids.salon1 = (await Room.create({ name: 'Salón 1' })).id;
        ids.salon2 = (await Room.create({ name: 'Salón 2' })).id;
        await TeacherRoom.bulkCreate([
            { teacherId: ids.laura, roomId: ids.salon1 },
            { teacherId: ids.laura, roomId: ids.salon2 },
            { teacherId: ids.andres, roomId: ids.salon2 },
        ]);

        server = await startServer();
        for (const [role, email] of [['academy', 'academia@test.co'], ['laura', 'laura@test.co'], ['andres', 'andres@test.co'], ['sofia', 'sofia@test.co']]) {
            tokens[role] = (await login(email)).body.token;
        }
    });

    after(async () => {
        await server.close();
        await teardownDatabase();
    });

    test('franjas: solo de reposición, en salones asignados y sin choques', async () => {
        const window = (role, body) => call('POST', '/availability', role, body);

        const classWindow = await window('laura', { roomId: ids.salon2, weekday: 1, startTime: '08:00', endTime: '12:00', type: 'clase' });
        assert.equal(classWindow.body.code, 'tipo_invalido');

        const lauraSaturday = await window('laura', { roomId: ids.salon2, weekday: 6, startTime: '09:00', endTime: '11:00', type: 'reposicion', capacity: 2 });
        assert.equal(lauraSaturday.status, 201, lauraSaturday.body.message);
        ids.lauraSaturday = lauraSaturday.body.id;

        const andresClash = await window('andres', { roomId: ids.salon2, weekday: 6, startTime: '10:00', endTime: '12:00', type: 'reposicion' });
        assert.equal(andresClash.body.code, 'choque_salon');

        const lauraTwoPlaces = await window('laura', { roomId: ids.salon1, weekday: 6, startTime: '10:00', endTime: '11:00', type: 'reposicion' });
        assert.equal(lauraTwoPlaces.body.code, 'choque_profesor');

        const lateNight = await window('laura', { roomId: ids.salon1, weekday: 2, startTime: '21:00', endTime: '22:00', type: 'reposicion' });
        assert.equal(lateNight.status, 400);

        const notAssigned = await window('andres', { roomId: ids.salon1, weekday: 3, startTime: '10:00', endTime: '11:00', type: 'reposicion' });
        assert.equal(notAssigned.body.code, 'salon_no_asignado');

        const foreignEdit = await call('PUT', `/availability/${ids.lauraSaturday}`, 'andres', { endTime: '13:00' });
        assert.equal(foreignEdit.status, 403);
    });

    // 4-week cycles (old billing): a paid cycle gets its classes from the new schedule.
    // The monthly billing is covered in service.monthlyBilling.test.js.
    test('con un ciclo pagado, el horario que asigna el profesor le genera las clases del ciclo', async () => {
        const slot = { studentId: ids.sofia, roomId: ids.salon2, weekday: 1, startTime: '09:00' };
        const notMine = await call('POST', '/fixed-schedules', 'laura', { ...slot, studentId: ids.tomas });
        assert.equal(notMine.body.code, 'profesor_no_asignado');

        const cycle = await call('POST', '/cycles', 'academy', { studentId: ids.sofia });
        const confirmed = await call('POST', `/cycles/${cycle.body.id}/confirm`, 'academy', {});
        assert.equal(confirmed.body.summary.unscheduled, true);

        const ok = await call('POST', '/fixed-schedules', 'laura', slot);
        assert.equal(ok.status, 201, ok.body.message);
        assert.equal(ok.body.scheduled, 4);
        ids.sofiaFixed = ok.body.fixed.id;
        ids.cycleId = cycle.body.id;
        ids.cycleEnd = (await models.Cycle.findByPk(cycle.body.id)).endDate;

        // Andrés cannot use Salón 2 at that time
        await models.Cycle.create({ studentId: ids.tomas, startDate: localDate(new Date()), endDate: addDays(localDate(new Date()), 27), plan: 'paquete_4', classesIncluded: 4, amount: 260000, status: 'activo', paymentStatus: 'pagado' });
        const clash = await call('POST', '/fixed-schedules', 'andres', { studentId: ids.tomas, roomId: ids.salon2, weekday: 1, startTime: '09:30' });
        assert.equal(clash.body.code, 'choque_salon');
    });

    test('el otro profesor ve la clase de Sofía como "Ocupado", sin nombre', async () => {
        const res = await call('GET', `/rooms/${ids.salon2}/week?date=${addDays(localDate(new Date()), 7)}`, 'andres');
        const busy = res.body.blocks.filter(b => b.kind === 'ocupado');
        assert.ok(busy.length >= 2);
        assert.ok(!JSON.stringify(res.body).includes('Sofía'));

        const own = await call('GET', `/rooms/${ids.salon2}/week?date=${addDays(localDate(new Date()), 7)}`, 'laura');
        assert.ok(own.body.blocks.some(b => b.studentName === 'Sofía'));
    });

    test('cancelar: avisa al estudiante y queda la reposición pendiente', async () => {
        const lessons = await call('GET', '/lessons', 'laura');
        assert.equal(lessons.body.length, 4);
        assert.equal((await call('GET', '/lessons', 'andres')).body.length, 0);
        [ids.lesson1, ids.lesson2, ids.lesson3] = lessons.body.map(l => l.id);

        assert.equal((await call('POST', '/lessons/cancel', 'andres', { lessonIds: [ids.lesson1] })).status, 403);

        const cancelled = await call('POST', '/lessons/cancel', 'laura', { lessonIds: [ids.lesson1], reason: 'Cita médica' });
        assert.equal(cancelled.body[0].status, 'cancelada_por_profesor');

        const notices = (await call('GET', '/notices', 'sofia')).body;
        const cancelledNotice = notices.find(n => n.category === 'clase_cancelada');
        assert.match(cancelledNotice.message, /^Tu profesor canceló tu clase del .+\. No la pierdes: tu profesor te asignará la reposición a más tardar el .+\. Motivo: Cita médica\.$/);

        const pending = await call('GET', '/lessons/pending-makeups', 'laura');
        assert.deepEqual(pending.body.map(l => l.id), [ids.lesson1]);
    });

    test('el profesor agenda la reposición en un hueco libre', async () => {
        const booked = await call('POST', `/lessons/${ids.lesson1}/makeup`, 'laura', { roomId: ids.salon1, startsAt: toUtc(nextWeekday(2), '15:00').toISOString() });
        assert.equal(booked.status, 200, booked.body.message);
        const notices = await call('GET', '/notices', 'sofia');
        assert.match(notices.body[0].message, /^Tu reposición de la clase del .+ quedó para el .+\.$/);
        assert.equal((await call('GET', '/lessons/pending-makeups', 'laura')).body.length, 0);
    });

    test('mover una clase: queda en el nuevo horario en un solo paso y avisa al estudiante', async () => {
        // A class is moved within its own month: the day before or after it, at 16:00
        const day = localDate((await models.Lesson.findByPk(ids.lesson2)).startsAt);
        const after = addDays(day, 1);
        const target = toUtc(after.slice(0, 7) === day.slice(0, 7) ? after : addDays(day, -1), '16:00');
        const moved = await call('POST', `/lessons/${ids.lesson2}/move`, 'laura', { startsAt: target.toISOString() });
        assert.equal(moved.status, 200, moved.body.message);
        assert.equal(new Date(moved.body.makeup.startsAt).getTime(), target.getTime());
        assert.equal((await models.Lesson.findByPk(ids.lesson2)).status, 'cancelada_por_profesor');
        assert.equal((await call('GET', '/lessons/pending-makeups', 'laura')).body.length, 0);

        const notices = await call('GET', '/notices', 'sofia');
        assert.match(notices.body[0].message, /^Tu clase del .+ se movió para el .+\.$/);

        assert.equal((await call('POST', `/lessons/${ids.lesson3}/move`, 'andres', { startsAt: target.toISOString() })).status, 403);
    });

    test('la asistencia de una clase futura no se puede marcar', async () => {
        const res = await call('POST', `/lessons/${ids.lesson3}/attendance`, 'laura', { status: 'tomada' });
        assert.equal(res.body.code, 'clase_futura');
    });

    test('cambiar un horario fijo sin mover clases aplica desde el día siguiente al ciclo pagado', async () => {
        const res = await call('PUT', `/fixed-schedules/${ids.sofiaFixed}`, 'laura', { startTime: '10:00' });
        assert.equal(res.status, 200, res.body.message);
        assert.equal(res.body.fixed.validFrom, addDays(ids.cycleEnd, 1));
        assert.equal(res.body.movedLessons.length, 0);
        ids.sofiaFixedNext = res.body.fixed.id;
    });

    test('cambiar el horario moviendo las clases ya agendadas del ciclo', async () => {
        const before = (await call('GET', '/lessons?status=programada', 'laura')).body.filter(l => l.kind === 'regular' && new Date(l.startsAt) > new Date());
        assert.ok(before.length >= 1);

        const current = await models.FixedSchedule.findOne({ where: { studentId: ids.sofia, validTo: { [require('sequelize').Op.ne]: null } } });
        const res = await call('PUT', `/fixed-schedules/${current.id}`, 'laura', { weekday: 3, startTime: '17:00', moveUpcoming: true });
        assert.equal(res.status, 200, res.body.message);
        assert.equal(res.body.movedLessons.length, before.length);

        const after = (await call('GET', '/lessons?status=programada', 'laura')).body.filter(l => l.kind === 'regular' && new Date(l.startsAt) > new Date());
        assert.ok(after.every(l => localParts(l.startsAt).weekday === 3 && localParts(l.startsAt).time === '17:00'));

        const notice = (await call('GET', '/notices', 'sofia')).body[0];
        assert.match(notice.message, /miércoles a las 17:00\. Tus próximas \d clase\(s\) ya quedaron en el nuevo horario/);
    });

    test('la primera clase queda en el día que toca el profesor, aunque sea más adelante', async () => {
        await models.Cycle.create({ studentId: ids.valen, startDate: localDate(new Date()), endDate: addDays(localDate(new Date()), 27), plan: 'paquete_4', classesIncluded: 4, amount: 260000, status: 'activo', paymentStatus: 'pagado' });
        const day = addDays(nextWeekday(5), 14);
        const res = await call('POST', '/fixed-schedules', 'laura', { studentId: ids.valen, roomId: ids.salon1, weekday: 5, startTime: '08:00', validFrom: day });
        assert.equal(res.status, 201, res.body.message);
        assert.equal(localParts(res.body.firstClassAt).date, day);

        const past = await call('POST', '/fixed-schedules', 'laura', { studentId: ids.valen, roomId: ids.salon1, weekday: 4, startTime: '08:00', validFrom: addDays(localDate(new Date()), -7) });
        assert.equal(past.body.code, 'fecha_pasada');
    });

    test('cambio de profesor: el horario viejo se libera y las clases pendientes pasan al nuevo profesor', async () => {
        const res = await call('PUT', `/students/${ids.sofia}`, 'academy', { teacherId: ids.andres });
        assert.equal(res.status, 200, res.body.message);
        assert.equal(res.body.teacherId, ids.andres);

        const current = await models.FixedSchedule.findAll({ where: { studentId: ids.sofia } });
        assert.ok(current.every(f => f.validTo && f.validTo < localDate(new Date())));

        const lauraUpcoming = (await call('GET', '/lessons?status=programada', 'laura')).body
            .filter(l => l.studentId === ids.sofia && new Date(l.startsAt) > new Date());
        assert.equal(lauraUpcoming.length, 0);

        const toSchedule = await call('GET', '/lessons/pending-makeups', 'andres');
        assert.ok(toSchedule.body.length >= 1);
        assert.ok(toSchedule.body.every(l => l.studentId === ids.sofia && l.reason === 'Cambio de profesor'));

        const andresNotices = await call('GET', '/notices', 'andres');
        assert.match(andresNotices.body[0].message, /te asignó a Sofía/);
    });

    test('borrar un profesor: primero hay que reasignar a sus estudiantes', async () => {
        const blocked = await call('DELETE', `/academy/teachers/${ids.andres}`, 'academy');
        assert.equal(blocked.status, 409);
        assert.match(blocked.body.message, /Sofía/);

        const stillHasValentina = await call('DELETE', `/academy/teachers/${ids.laura}`, 'academy');
        assert.equal(stillHasValentina.status, 409);
        await call('PUT', `/students/${ids.valen}`, 'academy', { teacherId: ids.andres });

        const removed = await call('DELETE', `/academy/teachers/${ids.laura}`, 'academy');
        assert.equal(removed.status, 200);
        const teachers = await call('GET', '/academy/teachers', 'academy');
        assert.deepEqual(teachers.body.map(t => t.name), ['Andrés']);
        // The old account cannot log in, and its email is freed (kept in the audit log)
        assert.notEqual((await login('laura@test.co')).status, 200);
        const old = await models.User.findByPk(ids.laura);
        assert.equal(old.active, false);
        assert.match(old.email, /^laura\+eliminado-[0-9a-f]{8}@test\.co$/);
        const audit = await models.AuditLog.findOne({ where: { entityType: 'teacher', entityId: ids.laura, action: 'eliminar' } });
        assert.equal(audit.details.email, 'laura@test.co');

        // A new teacher can be created with the same email
        const instrument = await models.Instrument.findOne();
        const again = await call('POST', '/academy/teachers', 'academy', {
            name: 'Laura', email: 'laura@test.co', password: PASSWORD, instrumentIds: [instrument.id],
        });
        assert.equal(again.status, 201, again.body.message);
        assert.notEqual(again.body.id, ids.laura);
        assert.equal((await login('laura@test.co')).status, 200);
    });

    test('archivar un estudiante: se oculta, no entra y se puede restaurar', async () => {
        const archived = await call('POST', `/students/${ids.tomas}/archive`, 'academy');
        assert.equal(archived.status, 200);
        assert.equal((await login('tomas@test.co')).status, 403);
        const list = await call('GET', '/students', 'academy');
        assert.ok(!list.body.some(s => s.id === ids.tomas));
        const archivedList = await call('GET', '/students?archived=1', 'academy');
        assert.ok(archivedList.body.some(s => s.id === ids.tomas));
        assert.equal(await models.FixedSchedule.count({ where: { studentId: ids.tomas, validTo: null } }), 0);

        await call('POST', `/students/${ids.tomas}/restore`, 'academy');
        assert.equal((await login('tomas@test.co')).status, 200);
    });

    test('archivar con clases pendientes: se avisa antes y esas clases se pierden', async () => {
        // Valentina's 4 classes moved to Andrés as "por agendar" when her teacher changed
        const preview = await call('GET', `/students/${ids.valen}/archive-preview`, 'academy');
        assert.equal(preview.status, 200);
        assert.equal(preview.body.upcoming + preview.body.owed, 4);
        assert.equal(preview.body.activeCycles, 1);

        const archived = await call('POST', `/students/${ids.valen}/archive`, 'academy');
        assert.equal(archived.body.lostClasses, 4);

        const lessons = await models.Lesson.findAll({ where: { studentId: ids.valen } });
        assert.ok(lessons.every(l => l.status === 'perdida' && l.reason === 'Estudiante archivado'));
        const pending = await call('GET', '/lessons/pending-makeups', 'andres');
        assert.ok(!pending.body.some(l => l.studentId === ids.valen));
        const cycle = await models.Cycle.findOne({ where: { studentId: ids.valen } });
        assert.equal(cycle.status, 'finalizado');
    });

    test('un estudiante archivado no aparece en el calendario ni ocupa el espacio', async () => {
        // Sofía (with Andrés now) gets a class; once archived it disappears and the slot is free
        const lesson = await models.Lesson.create({
            cycleId: (await models.Cycle.findOne({ where: { studentId: ids.sofia } })).id,
            studentId: ids.sofia, teacherId: ids.andres, roomId: ids.salon2,
            startsAt: toUtc(nextWeekday(4), '11:00'), endsAt: toUtc(nextWeekday(4), '12:00'),
        });
        const week = (role) => call('GET', `/rooms/${ids.salon2}/week?date=${nextWeekday(4)}`, role);
        assert.ok((await week('andres')).body.blocks.some(b => b.lessonId === lesson.id));

        await call('POST', `/students/${ids.sofia}/archive`, 'academy');
        const after = await week('andres');
        assert.ok(!after.body.blocks.some(b => b.lessonId === lesson.id || b.studentName === 'Sofía'));
        assert.ok(!(await call('GET', '/lessons', 'andres')).body.some(l => l.studentId === ids.sofia));

        // Tomás can take that exact time
        await models.Cycle.update({ status: 'activo', paymentStatus: 'pagado' }, { where: { studentId: ids.tomas } });
        const taken = await call('POST', '/fixed-schedules', 'andres', {
            studentId: ids.tomas, roomId: ids.salon2, weekday: 4, startTime: '11:00', validFrom: nextWeekday(4),
        });
        assert.equal(taken.status, 201, taken.body.message);
    });

    test('solo un estudiante archivado se puede eliminar, y se borra todo lo suyo', async () => {
        const active = await call('DELETE', `/students/${ids.tomas}`, 'academy');
        assert.equal(active.status, 409);

        // She had read an announcement: her read mark goes with her
        const announcement = await models.Announcement.create({
            title: 'Recital', content: 'Sábado', date: localDate(new Date()), author: 'Laura', teacherId: ids.laura, audience: 'mis_estudiantes',
        });
        await models.AnnouncementRead.create({ announcementId: announcement.id, userId: ids.sofia });

        const deleted = await call('DELETE', `/students/${ids.sofia}`, 'academy');
        assert.equal(deleted.status, 200, deleted.body.message);
        assert.equal(await models.User.count({ where: { id: ids.sofia } }), 0);
        assert.equal(await models.AnnouncementRead.count({ where: { userId: ids.sofia } }), 0);
        assert.equal(await models.Lesson.count({ where: { studentId: ids.sofia } }), 0);
        assert.equal(await models.Cycle.count({ where: { studentId: ids.sofia } }), 0);
        assert.equal((await call('GET', '/students?archived=1', 'academy')).body.some(s => s.id === ids.sofia), false);
    });
});
