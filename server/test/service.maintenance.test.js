const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase } = require('./helpers');
const { toUtc, localParts, addHours } = require('../domain/time');

// Lunes 2 de noviembre de 2026, 8:00 en Bogotá
const NOW = toUtc('2026-11-02', '08:00');

describe('tareas automáticas', () => {
    let models;
    let tasks;
    let overview;
    const people = {};
    const cycles = {};

    const lessonOn = async (studentId, date) =>
        (await models.Lesson.findAll({ where: { studentId } })).find(l => localParts(l.startsAt).date === date);
    const noticesOf = async (userId) =>
        (await models.NoticeRecipient.findAll({ where: { userId }, include: [{ model: models.Notice, as: 'notice' }], order: [['createdAt', 'ASC']] }))
            .map(r => r.notice);

    before(async () => {
        models = await setupDatabase();
        tasks = require('../services/maintenanceService');
        overview = require('../services/academyOverviewService');
        const { confirmCyclePayment } = require('../services/cycleService');
        const { User, Room, TeacherRoom, Availability, FixedSchedule, Cycle } = models;
        const pwd = 'clave-de-prueba-1';

        people.academy = await User.create({ name: 'Academia', email: 'a@t.co', password: pwd, role: 'academy' });
        people.laura = await User.create({ name: 'Laura', email: 'laura@t.co', password: pwd, role: 'teacher' });
        people.sofia = await User.create({ name: 'Sofía', email: 'sofia@t.co', password: pwd, role: 'student', teacherId: people.laura.id });
        people.valen = await User.create({ name: 'Valentina', email: 'valen@t.co', password: pwd, role: 'student', teacherId: people.laura.id });
        const room = await Room.create({ name: 'Salón 2' });
        people.room = room;
        await TeacherRoom.create({ teacherId: people.laura.id, roomId: room.id });
        await Availability.create({ teacherId: people.laura.id, roomId: room.id, weekday: 3, startTime: '14:00', endTime: '18:00', type: 'clase' });
        for (const [student, time] of [[people.sofia, '15:00'], [people.valen, '16:00']]) {
            await FixedSchedule.create({
                studentId: student.id, teacherId: people.laura.id, roomId: room.id, weekday: 3, startTime: time, durationMinutes: 60, validFrom: '2026-10-01',
            });
            const cycle = await Cycle.create({
                studentId: student.id, startDate: '2026-11-02', endDate: '2026-11-29', plan: 'paquete_4', classesIncluded: 4, amount: 260000,
            });
            await confirmCyclePayment({ cycleId: cycle.id, actor: people.academy, now: NOW });
            cycles[student.name] = cycle.id;
        }
    });

    after(async () => {
        await teardownDatabase();
    });

    test('un cupo apartado se libera solo al vencer sus 48 horas', async () => {
        const base = { teacherId: people.laura.id, scheduledAt: NOW, holdRoomId: people.room.id, holdWeekday: 3, holdDurationMinutes: 60, holdStatus: 'apartado' };
        const expired = await models.Assessment.create({ ...base, studentName: 'Mariana', holdStartTime: '17:00', holdExpiresAt: NOW });
        const alive = await models.Assessment.create({ ...base, studentName: 'Lucía', holdStartTime: '14:00', holdExpiresAt: addHours(NOW, 1) });

        assert.equal(await tasks.releaseExpiredHolds(NOW), 1);
        assert.equal((await expired.reload()).holdStatus, 'liberado');
        assert.equal((await alive.reload()).holdStatus, 'apartado');
        assert.equal(await tasks.releaseExpiredHolds(NOW), 0);

        const [notice] = await noticesOf(people.academy.id);
        assert.match(notice.message, /Mariana/);
    });

    test('un día de cierre cancela las clases de ese día y deja la reposición pendiente', async () => {
        await models.ClosureDay.create({ date: '2026-11-11', reason: 'Festivo' });
        const empty = await models.ClosureDay.create({ date: '2026-11-13', reason: 'Puente' });

        assert.equal(await tasks.applyClosures(NOW), 2);
        assert.equal((await lessonOn(people.sofia.id, '2026-11-11')).status, 'cancelada_por_academia');
        assert.equal((await lessonOn(people.valen.id, '2026-11-11')).status, 'cancelada_por_academia');
        assert.equal((await empty.reload()).appliedAt, null);
        assert.equal(await tasks.applyClosures(NOW), 0);

        const [notice] = await noticesOf(people.sofia.id);
        assert.match(notice.message, /^La academia canceló tu clase del miércoles 11 de noviembre, 15:00\. .*Motivo: Cierre de la academia: Festivo\.$/);
    });

    test('recordatorio de pago: al estudiante si hay mensualidad siguiente, a la academia si no la hay', async () => {
        await models.Cycle.create({
            studentId: people.sofia.id, startDate: '2026-11-30', endDate: '2026-12-27', plan: 'paquete_4', classesIncluded: 4, amount: 260000,
        });
        const before = (await noticesOf(people.academy.id)).length;

        // dias_recordatorio_pago = 3: on the 25th the 29th is still too far; on the 27th both cycles are due
        assert.equal(await tasks.sendPaymentReminders(toUtc('2026-11-25', '08:00')), 0);
        assert.equal(await tasks.sendPaymentReminders(toUtc('2026-11-27', '08:00')), 2);
        assert.equal(await tasks.sendPaymentReminders(toUtc('2026-11-28', '08:00')), 0);

        const sofia = await noticesOf(people.sofia.id);
        assert.match(sofia[sofia.length - 1].message, /^Tu ciclo vence el domingo 29 de noviembre\. La próxima mensualidad \(\$260\.000\) empieza el lunes 30 de noviembre: confirma tu pago para asegurar tu horario\.$/);
        const academy = await noticesOf(people.academy.id);
        assert.equal(academy.length, before + 1);
        assert.match(academy[academy.length - 1].message, /Valentina vence el domingo 29 de noviembre y aún no tiene la siguiente mensualidad/);
    });

    test('panel: cobros del mes (pagado y pendiente), comprobantes por revisar y cobros por pagar', async () => {
        const cityId = (await models.City.findOne({ where: { name: 'Pereira' } })).id;
        const charge = (studentId, values) => models.Payment.create({ studentId, cityId, amount: 260000, ...values });
        await charge(people.sofia.id, { type: 'mensualidad', period: '2026-12', dueDate: '2026-12-05', status: 'aprobado' });
        await charge(people.valen.id, { type: 'mensualidad', period: '2026-12', dueDate: '2026-12-05', status: 'en_revision' });
        await charge(people.valen.id, { type: 'clase_suelta', period: '2026-12', amount: 65000, dueDate: '2026-11-25', status: 'por_pagar' });
        await charge(people.sofia.id, { type: 'mensualidad', period: '2026-12', status: 'anulado' });

        const data = await overview.buildAcademyOverview({ now: toUtc('2026-11-27', '08:00'), month: '2026-12' });
        assert.equal(data.income.paid, 260000);
        assert.equal(data.income.pending, 325000);
        assert.equal(data.income.paidCount, 1);
        assert.deepEqual(data.payments.inReview.map(p => [p.studentName, p.concept]), [['Valentina', 'Mensualidad de diciembre de 2026']]);
        assert.deepEqual(data.payments.toPay.map(p => [p.studentName, p.concept, p.overdue]), [['Valentina', 'Clases sueltas de diciembre de 2026', true]]);
        assert.equal(data.cyclesEnding, undefined);
        assert.equal(data.pendingMakeups, 2);
        assert.equal(data.occupancy[0].roomName, 'Salón 2');
        assert.ok(data.occupancy[0].bookedMinutes >= 120);
    });

    test('una clase que terminó sin cancelarse se da por tomada; la que marcó el profesor se respeta', async () => {
        await (await lessonOn(people.valen.id, '2026-11-04')).update({ status: 'perdida' });
        // Nov 4 classes end at 16:00 (Sofía) and 17:00 (Valentina)
        assert.equal(await tasks.markFinishedLessons(toUtc('2026-11-04', '15:59')), 0);
        assert.equal(await tasks.markFinishedLessons(toUtc('2026-11-04', '16:00')), 1);
        assert.equal((await lessonOn(people.sofia.id, '2026-11-04')).status, 'tomada');
        assert.equal((await lessonOn(people.valen.id, '2026-11-04')).status, 'perdida');
        assert.equal((await lessonOn(people.sofia.id, '2026-11-11')).status, 'cancelada_por_academia');
        assert.equal(await tasks.markFinishedLessons(toUtc('2026-11-04', '16:00')), 0);
    });

    test('al vencer el ciclo: lo no marcado cuenta como tomada y lo que debe la academia sigue pendiente', async () => {
        const afterEnd = toUtc('2026-11-30', '00:30');

        const result = await tasks.expireCycles(afterEnd);
        assert.equal(result.cycles, 2);
        assert.equal((await models.Cycle.findByPk(cycles['Sofía'])).status, 'finalizado');
        assert.equal((await lessonOn(people.sofia.id, '2026-11-04')).status, 'tomada');
        assert.equal((await lessonOn(people.sofia.id, '2026-11-18')).status, 'tomada');
        assert.equal((await lessonOn(people.sofia.id, '2026-11-11')).status, 'cancelada_por_academia');
        assert.equal((await tasks.expireCycles(afterEnd)).cycles, 0);
    });

    test('una mensualidad nunca pagada cuyas fechas pasaron queda vencida', async () => {
        const old = await models.Cycle.create({
            studentId: people.valen.id, startDate: '2026-09-28', endDate: '2026-10-25', plan: 'paquete_4', classesIncluded: 4, amount: 260000,
        });
        assert.equal(await tasks.markOverduePayments(NOW), 1);
        await old.reload();
        assert.equal(old.paymentStatus, 'vencido');
        assert.equal(old.status, 'cancelado');
    });

    test('runMaintenance corre todo y dos llamadas simultáneas comparten la misma ejecución', async () => {
        const first = tasks.runMaintenance(toUtc('2026-11-30', '09:00'));
        const second = tasks.runMaintenance(toUtc('2026-11-30', '09:00'));
        assert.equal(first, second);
        const result = await first;
        assert.equal(typeof result.holdsReleased, 'number');
        assert.equal(result.expired.cycles, 0);
    });
});
