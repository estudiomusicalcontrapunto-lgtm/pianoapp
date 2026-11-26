// Phase 3 of the monthly billing: the class rules wired to the services.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase } = require('./helpers');
const { toUtc, localParts } = require('../domain/time');

describe('reglas de clases en los servicios', () => {
    let models;
    const people = {};
    const ids = {};
    let cycleId;

    const lesson = (studentId, date, time, extra = {}) => models.Lesson.create({
        cycleId, studentId, teacherId: people.laura.id, roomId: ids.salon2, startsAt: toUtc(date, time),
        endsAt: new Date(toUtc(date, time).getTime() + 3600000), ...extra,
    });

    before(async () => {
        models = await setupDatabase();
        const { User, Room, TeacherRoom, Availability, Cycle, City } = models;
        const pereira = await City.findOne({ where: { name: 'Pereira' } });
        const pwd = 'clave-de-prueba-1';
        people.academy = await User.create({ name: 'Academia', email: 'a@t.co', password: pwd, role: 'academy' });
        people.laura = await User.create({ name: 'Laura', email: 'laura@t.co', password: pwd, role: 'teacher', cityId: pereira.id });
        people.andres = await User.create({ name: 'Andrés', email: 'andres@t.co', password: pwd, role: 'teacher', cityId: pereira.id });
        people.sofia = await User.create({ name: 'Sofía', email: 'sofia@t.co', password: pwd, role: 'student', teacherId: people.laura.id, cityId: pereira.id });
        people.tomas = await User.create({ name: 'Tomás', email: 'tomas@t.co', password: pwd, role: 'student', teacherId: people.andres.id, cityId: pereira.id });
        ids.salon2 = (await Room.create({ name: 'Salón 2', cityId: pereira.id })).id;
        await TeacherRoom.create({ teacherId: people.laura.id, roomId: ids.salon2 });
        await TeacherRoom.create({ teacherId: people.andres.id, roomId: ids.salon2 });
        ids.window = (await Availability.create({
            teacherId: people.laura.id, roomId: ids.salon2, weekday: 6, startTime: '09:00', endTime: '11:00', type: 'reposicion', capacity: 1,
        })).id;
        cycleId = (await Cycle.create({
            studentId: people.sofia.id, startDate: '2027-03-01', endDate: '2027-03-28', plan: 'paquete_4', classesIncluded: 4, amount: 260000,
            status: 'activo', paymentStatus: 'pagado',
        })).id;
        await Cycle.create({
            studentId: people.tomas.id, startDate: '2027-03-01', endDate: '2027-03-28', plan: 'paquete_4', classesIncluded: 4, amount: 260000,
            status: 'activo', paymentStatus: 'pagado',
        });
    });

    after(teardownDatabase);

    test('7. la reposición que el profesor no dio a tiempo se descuenta del siguiente pago (una sola vez)', async () => {
        const { expirePendingMakeups } = require('../services/maintenanceService');
        const cancelled = await lesson(people.sofia.id, '2027-03-23', '16:00', { status: 'cancelada_por_profesor', reason: 'Viaje' });

        // Still within its deadline (April 30th)
        assert.deepEqual(await expirePendingMakeups(toUtc('2027-04-30', '20:00')), { lost: 0, discounted: 0 });

        assert.deepEqual(await expirePendingMakeups(toUtc('2027-05-01', '00:05')), { lost: 0, discounted: 1 });
        const adjustment = await models.PaymentAdjustment.findOne({ where: { lessonId: cancelled.id } });
        assert.equal(adjustment.kind, 'descuento_clase_no_repuesta');
        assert.equal(adjustment.amount, -65000);
        assert.equal(adjustment.studentId, people.sofia.id);
        const closed = await cancelled.reload();
        assert.equal(closed.makeupOutcome, 'descontada');

        // Running it again changes nothing
        assert.deepEqual(await expirePendingMakeups(toUtc('2027-05-02', '00:05')), { lost: 0, discounted: 0 });
        assert.equal(await models.PaymentAdjustment.count({ where: { lessonId: cancelled.id } }), 1);

        const notice = await models.NoticeRecipient.findOne({
            where: { userId: people.sofia.id }, include: [{ model: models.Notice, as: 'notice', where: { category: 'descuento_clase' } }],
        });
        assert.match(notice.notice.message, /Te descontamos \$65\.000 de tu próximo pago/);
    });

    test('registro de cancelaciones: por profesor y mes, sin las clases que solo se movieron', async () => {
        const { buildCancellationReport } = require('../services/cancellationReportService');
        const pending = await lesson(people.sofia.id, '2027-03-09', '16:00', { status: 'cancelada_por_profesor', reason: 'Enfermedad' });
        const madeUp = await lesson(people.sofia.id, '2027-03-02', '16:00', { status: 'cancelada_por_profesor' });
        await lesson(people.sofia.id, '2027-03-03', '18:00', { kind: 'reposicion', originalLessonId: madeUp.id, status: 'tomada' });
        await lesson(people.sofia.id, '2027-03-16', '16:00', { status: 'cancelada_por_profesor', moved: true });

        const report = await buildCancellationReport({ month: '2027-03', now: toUtc('2027-03-20', '09:00') });
        assert.equal(report.teachers.length, 1);
        const laura = report.teachers[0];
        assert.equal(laura.teacherName, 'Laura');
        assert.equal(laura.total, 3);
        assert.equal(laura.pending, 1);
        assert.equal(laura.discounted, 1);
        const byDate = Object.fromEntries(laura.lessons.map(l => [localParts(l.startsAt).date, l]));
        assert.equal(byDate['2027-03-02'].makeupStatus, 'repuesta');
        assert.equal(byDate['2027-03-09'].makeupStatus, 'pendiente');
        assert.equal(byDate['2027-03-09'].deadline, '2027-04-30');
        assert.equal(byDate['2027-03-09'].reason, 'Enfermedad');
        assert.equal(byDate['2027-03-23'].makeupStatus, 'descontada');
        assert.equal(byDate['2027-03-16'], undefined, 'una clase movida no es una cancelación');
        assert.ok(pending);

        await assert.rejects(buildCancellationReport({ month: 'marzo' }), { code: 'mes_invalido' });
    });

    test('8. una clase fija nueva ocupa la franja de reposición libre de otro profesor y se le avisa', async () => {
        const { createFixedSchedule } = require('../services/fixedScheduleService');
        // Saturday 9:00-10:00 in Salón 2, over Laura's 9:00-11:00 make-up window
        await createFixedSchedule({
            studentId: people.tomas.id, teacherId: people.andres.id, roomId: ids.salon2, weekday: 6, startTime: '09:00', validFrom: '2027-03-01',
        }, { actor: people.andres, now: toUtc('2027-03-01', '08:00') });

        const window = await models.Availability.findByPk(ids.window);
        assert.equal(window.startTime, '10:00');
        assert.equal(window.endTime, '11:00');
        const notice = await models.NoticeRecipient.findOne({
            where: { userId: people.laura.id }, include: [{ model: models.Notice, as: 'notice', where: { category: 'franja_ocupada' } }],
        });
        assert.match(notice.notice.message, /sábados de 09:00 a 11:00 lo ocupó en parte una clase fija nueva\. Queda de 10:00 a 11:00/);
    });

    test('8b. pero no si ya hay un alumno agendado en esa franja', async () => {
        const { createFixedSchedule } = require('../services/fixedScheduleService');
        await lesson(people.sofia.id, '2027-03-13', '10:00', { kind: 'reposicion', availabilityId: ids.window });
        await assert.rejects(
            createFixedSchedule({
                studentId: people.tomas.id, teacherId: people.andres.id, roomId: ids.salon2, weekday: 6, startTime: '10:00', validFrom: '2027-03-01',
            }, { actor: people.andres, now: toUtc('2027-03-01', '08:00') }),
            (error) => {
                assert.equal(error.code, 'reposicion_agendada');
                assert.match(error.message, /ya hay un estudiante agendado ahí el sábado 13 de marzo, 10:00/);
                return true;
            }
        );
        const window = await models.Availability.findByPk(ids.window);
        assert.equal(window.startTime, '10:00', 'la franja queda como estaba');
    });

    test('la franja con reposiciones agendadas no se quita ni se cambia hasta mover o cancelar esas clases', async () => {
        const { removeAvailability, saveAvailability } = require('../services/availabilityService');
        const { rescheduleLesson } = require('../services/lessonService');
        const now = toUtc('2027-03-01', '08:00');
        // Sofía is booked on Saturday March 13th at 10:00 in the 10:00-11:00 window (test 8b)
        await assert.rejects(removeAvailability({ id: ids.window, actor: people.laura, now }), (error) => {
            assert.equal(error.code, 'reposiciones_agendadas');
            assert.match(error.message, /^Esta franja tiene reposiciones agendadas: Sofía el sábado 13 de marzo, 10:00\. Para quitarla, primero mueve o cancela esas clases en Mi agenda\.$/);
            return true;
        });
        await assert.rejects(
            saveAvailability({ id: ids.window, data: { weekday: 5 }, actor: people.laura, now }),
            (error) => error.code === 'reposiciones_agendadas' && /Para cambiarla así/.test(error.message)
        );
        // A change that keeps her class inside the window is fine
        await saveAvailability({ id: ids.window, data: { endTime: '12:00' }, actor: people.laura, now });
        assert.equal((await models.Availability.findByPk(ids.window)).endTime, '12:00');

        // Once the class is cancelled, the window can go
        const booked = await models.Lesson.findOne({ where: { availabilityId: ids.window } });
        await booked.update({ status: 'cancelada_por_profesor' });
        await removeAvailability({ id: ids.window, actor: people.laura, now });
        assert.equal((await models.Availability.findByPk(ids.window)).active, false);

        // A removed window takes no new make-ups
        const regular = await lesson(people.sofia.id, '2027-03-10', '16:00');
        await assert.rejects(
            rescheduleLesson({ lessonId: regular.id, actor: people.sofia, availabilityId: ids.window, startsAt: toUtc('2027-03-20', '10:00'), now }),
            { code: 'franja_invalida' }
        );
    });
});
