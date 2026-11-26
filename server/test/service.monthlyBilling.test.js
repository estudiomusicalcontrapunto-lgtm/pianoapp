// Monthly billing with the database, on the real calendar (Pereira: 260.000 / 65.000).
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase } = require('./helpers');
const { toUtc, localParts } = require('../domain/time');

describe('cobro mensual', () => {
    let models;
    let billing;
    let fixedSchedules;
    let lessons;
    const people = {};
    const ids = {};

    const datesOf = async (studentId, period) => (await models.Lesson.findAll({
        where: { studentId, ...(period && { period }) }, order: [['startsAt', 'ASC']],
    })).map(l => localParts(l.startsAt).date);

    const assign = (student, { weekday, startTime, validFrom, startChoice }, now) =>
        fixedSchedules.addFixedSchedule({
            data: { studentId: student.id, teacherId: people.laura.id, roomId: ids.salon, weekday, startTime, validFrom, startChoice },
            actor: people.laura,
            now,
        });

    before(async () => {
        models = await setupDatabase();
        billing = require('../services/billingService');
        fixedSchedules = require('../services/fixedScheduleService');
        lessons = require('../services/lessonService');
        const { User, Room, TeacherRoom, City } = models;
        const pereira = await City.findOne({ where: { name: 'Pereira' } });
        const pwd = 'clave-de-prueba-1';
        const student = (name) => User.create({ name, email: `${name.toLowerCase()}@t.co`, password: pwd, role: 'student', teacherId: people.laura.id, cityId: pereira.id });
        people.academy = await User.create({ name: 'Academia', email: 'a@t.co', password: pwd, role: 'academy' });
        people.laura = await User.create({ name: 'Laura', email: 'laura@t.co', password: pwd, role: 'teacher', cityId: pereira.id });
        for (const name of ['Junio', 'Enero', 'Febrero', 'Marta', 'Pedro', 'Diciembre']) people[name] = await student(name);
        ids.salon = (await Room.create({ name: 'Salón 1', cityId: pereira.id })).id;
        await TeacherRoom.create({ teacherId: people.laura.id, roomId: ids.salon });
    });

    after(teardownDatabase);

    // The academy decides the charges; the teacher only books classes and weekly times
    const teacherBooks = (paymentId, date, time) =>
        billing.scheduleSingleClass({ paymentId, actor: people.laura, roomId: ids.salon, startsAt: toUtc(date, time), now: toUtc(`${date.slice(0, 7)}-01`, '05:00') });

    // The student sent the receipt and the academy approves it
    const academyApproves = async (paymentId, now) => {
        await models.Payment.update({ status: 'en_revision' }, { where: { id: paymentId } });
        return require('../services/paymentService').approvePayment({ paymentId, actor: people.academy, now });
    };

    test('1. alumno que entra el martes 15 de junio de 2027: la academia le da 3 clases sueltas (195.000) y el profesor las agenda', async () => {
        const now = toUtc('2027-06-14', '10:00');
        const { payment, left } = await billing.bookSingleClasses({ studentId: people.Junio.id, period: '2027-06', count: 3, actor: people.academy, now });
        assert.equal(payment.type, 'clase_suelta');
        assert.equal(payment.amount, 195000);
        assert.equal(payment.dueDate, '2027-06-17');
        assert.equal(left, 3);
        assert.deepEqual((await billing.pendingSingleClasses({ actor: people.laura })).map(p => [p.studentName, p.left, p.paymentStatus]), [['Junio', 3, 'por_pagar']]);

        // Until the academy approves the payment the teacher cannot book them (neither while in review)
        await assert.rejects(teacherBooks(payment.id, '2027-06-15', '16:00'), { code: 'pago_sin_aprobar' });
        await models.Payment.update({ status: 'en_revision' }, { where: { id: payment.id } });
        await assert.rejects(teacherBooks(payment.id, '2027-06-15', '16:00'), { code: 'pago_sin_aprobar' });
        assert.equal(await models.Lesson.count({ where: { studentId: people.Junio.id } }), 0);
        await academyApproves(payment.id, now);
        const notice = await models.Notice.findOne({ where: { title: 'Pago aprobado: ya puedes agendar' } });
        assert.ok(notice, 'el profesor sabe que ya puede agendarlas');

        for (const date of ['2027-06-15', '2027-06-22', '2027-06-29']) await teacherBooks(payment.id, date, '16:00');
        assert.deepEqual(await datesOf(people.Junio.id, '2027-06'), ['2027-06-15', '2027-06-22', '2027-06-29']);
        // Not more than the academy gave, and only in that month
        await assert.rejects(teacherBooks(payment.id, '2027-06-24', '16:00'), { code: 'clases_completas' });
        assert.deepEqual(await billing.pendingSingleClasses({ actor: people.laura }), []);

        // The weekly time from July: on July 1st the mensualidad comes by itself, with the July classes
        const weekly = await assign(people.Junio, { weekday: 2, startTime: '16:00', validFrom: '2027-07-06' }, now);
        assert.equal(weekly.needsCharge, true, 'sin cobro de julio todavía: el horario queda reservado');
        assert.equal(weekly.scheduled, 0);
        assert.equal(await billing.runMonthlyBilling(toUtc('2027-07-01', '06:00')), 1);
        const july = await models.Payment.findOne({ where: { studentId: people.Junio.id, period: '2027-07' } });
        assert.equal(july.type, 'mensualidad');
        assert.equal(july.amount, 260000);
        assert.equal(july.dueDate, '2027-07-05');
        assert.deepEqual(await datesOf(people.Junio.id, '2027-07'), ['2027-07-06', '2027-07-13', '2027-07-20', '2027-07-27']);
    });

    test('2. alumno que entra el jueves 28 de enero de 2027: 1 clase suelta y la mensualidad de febrero; el profesor no cobra nada', async () => {
        const now = toUtc('2027-01-27', '10:00');
        const single = await billing.bookSingleClasses({ studentId: people.Enero.id, period: '2027-01', count: 1, actor: people.academy, now });
        assert.equal(single.payment.amount, 65000);
        await academyApproves(single.payment.id, now);
        await teacherBooks(single.payment.id, '2027-01-28', '15:00');
        await assert.rejects(teacherBooks(single.payment.id, '2027-02-04', '15:00'), { code: 'clases_completas' });

        // The academy charges February ahead; the teacher gives the weekly time tapping any week of February
        const feb = await billing.chargeMonthByHand({ studentId: people.Febrero.id, period: '2027-02', actor: people.academy, now });
        assert.equal(feb.payment.dueDate, '2027-02-05');
        assert.equal(feb.lessons, 0);
        // Before saving, the teacher sees where the time goes (the first is not the tapped day); nothing is saved.
        // The payment is not approved yet: no classes, the time waits for it
        const preview = await fixedSchedules.addFixedSchedule({
            data: { studentId: people.Febrero.id, teacherId: people.laura.id, roomId: ids.salon, weekday: 4, startTime: '16:00', validFrom: '2027-02-11' },
            actor: people.laura, now, dryRun: true,
        });
        assert.equal(preview.preview, true);
        assert.equal(preview.tappedDate, '2027-02-11');
        assert.equal(preview.fixed.validFrom, '2027-02-04');
        assert.deepEqual(preview.lessons, []);
        assert.deepEqual(preview.awaitingPayment, ['2027-02']);
        assert.equal(preview.needsCharge, false);
        assert.equal(await models.FixedSchedule.count({ where: { studentId: people.Febrero.id } }), 0);
        assert.equal(await models.Lesson.count({ where: { studentId: people.Febrero.id } }), 0);
        const weekly = await assign(people.Febrero, { weekday: 4, startTime: '16:00', validFrom: '2027-02-11' }, now);
        assert.equal(weekly.fixed.validFrom, '2027-02-04', 'desde la primera semana del mes cobrado');
        assert.equal(weekly.scheduled, 0, 'sin pago aprobado no hay clases en la agenda');
        assert.deepEqual(weekly.awaitingPayment, ['2027-02']);
        assert.deepEqual(await datesOf(people.Febrero.id, '2027-02'), []);
        // The academy approves the payment: the February classes come now
        await academyApproves(feb.payment.id, now);
        assert.deepEqual(await datesOf(people.Febrero.id, '2027-02'), ['2027-02-04', '2027-02-11', '2027-02-18', '2027-02-25']);
        assert.ok(await models.Notice.findOne({ where: { title: 'Pago aprobado: clases en tu agenda' } }), 'el profesor recibe el aviso');
        assert.equal(await models.Payment.count({ where: { studentId: people.Febrero.id } }), 1, 'el profesor no creó cobros');

        // Enero: weekly time without a February charge yet; February 1st charges it (Febrero already has it)
        const enero = await assign(people.Enero, { weekday: 4, startTime: '15:00', validFrom: '2027-02-04' }, now);
        assert.equal(enero.needsCharge, true);
        assert.equal(await billing.runMonthlyBilling(toUtc('2027-02-01', '06:00')), 1);
        assert.deepEqual(await datesOf(people.Enero.id, '2027-02'), ['2027-02-04', '2027-02-11', '2027-02-18', '2027-02-25']);
        assert.equal(await billing.runMonthlyBilling(toUtc('2027-02-01', '06:10')), 0);
    });

    test('clases sueltas de diciembre con fechas ya acordadas (3 × 65.000) y desde enero la mensualidad', async () => {
        const now = toUtc('2026-12-10', '10:00');
        const tuesdays = ['2026-12-15', '2026-12-22', '2026-12-29'];
        const { payment, lessons: booked, left } = await billing.bookSingleClasses({
            studentId: people.Diciembre.id, period: '2026-12', count: 3, actor: people.academy, now,
            classes: tuesdays.map(date => ({ date, startTime: '10:00', roomId: ids.salon })),
        });
        assert.equal(payment.amount, 195000);
        assert.equal(payment.dueDate, '2026-12-13');
        assert.equal(booked.length, 3);
        assert.equal(left, 0);
        assert.deepEqual(await datesOf(people.Diciembre.id, '2026-12'), tuesdays);
        // Only single classes, no weekly time: no mensualidad on day 1
        assert.equal(await billing.runMonthlyBilling(toUtc('2027-01-01', '06:00')), 0);

        // January: the academy charges the mensualidad and approves the payment; the teacher's weekly time fills January from its first week
        const january = await billing.chargeMonthByHand({ studentId: people.Diciembre.id, actor: people.academy, now: toUtc('2027-01-01', '08:00') });
        assert.equal(january.payment.amount, 260000);
        await academyApproves(january.payment.id, toUtc('2027-01-02', '09:00'));
        await assert.rejects(
            billing.chargeMonthByHand({ studentId: people.Diciembre.id, actor: people.academy, now: toUtc('2027-01-02', '08:00') }),
            { code: 'mes_ya_cobrado' }
        );
        const weekly = await assign(people.Diciembre, { weekday: 3, startTime: '10:00', validFrom: '2027-01-13' }, toUtc('2027-01-04', '10:00'));
        assert.equal(weekly.scheduled, 4);
        assert.deepEqual(await datesOf(people.Diciembre.id, '2027-01'), ['2027-01-06', '2027-01-13', '2027-01-20', '2027-01-27']);
    });
    test('una mensualidad cobrada tarde en el mes da días para pagar; el cobro automático solo corre hasta el día 5', async () => {
        const late = billing.chargeMonthByHand({ studentId: people.Febrero.id, period: '2027-09', actor: people.academy, now: toUtc('2027-09-20', '10:00') });
        const { payment } = await late;
        assert.equal(payment.dueDate, '2027-09-23');
        // The next morning it is not overdue: the horario stays
        await billing.enforcePaymentDeadlines(toUtc('2027-09-21', '08:00'));
        assert.equal((await models.Payment.findByPk(payment.id)).status, 'por_pagar');
        // Charging next month ahead keeps the usual deadline (October 5th)
        const ahead = await billing.chargeMonthByHand({ studentId: people.Febrero.id, period: '2027-10', actor: people.academy, now: toUtc('2027-09-20', '11:00') });
        assert.equal(ahead.payment.dueDate, '2027-10-05');
        // Mid-month the automatic charge does nothing
        assert.equal(await billing.runMonthlyBilling(toUtc('2027-09-10', '06:00')), 0);
        // Everything charged here is paid, so later tests are not affected
        await models.Payment.update({ status: 'aprobado' }, { where: { studentId: people.Febrero.id, period: ['2027-09', '2027-10'] } });
    });

    test('clases sueltas: nunca más que la mensualidad, en su mes y sin choques', async () => {
        const now = toUtc('2027-08-01', '08:00');
        const five = await billing.bookSingleClasses({ studentId: people.Pedro.id, period: '2027-08', count: 5, actor: people.academy, now });
        assert.equal(five.payment.calculation.uncapped, 325000);
        assert.equal(five.payment.amount, 260000);

        await assert.rejects(billing.bookSingleClasses({
            studentId: people.Pedro.id, period: '2027-08', count: 2, actor: people.academy, now,
            classes: [{ date: '2027-08-31', startTime: '09:00', roomId: ids.salon }, { date: '2027-09-01', startTime: '09:00', roomId: ids.salon }],
        }), { code: 'fuera_del_mes' });
        // Same room and time as another class: refused, nothing is created (not even the charge)
        await academyApproves(five.payment.id, now);
        await teacherBooks(five.payment.id, '2027-08-09', '08:00');
        const before = await models.Payment.count();
        await assert.rejects(billing.bookSingleClasses({
            studentId: people.Enero.id, period: '2027-08', count: 1, actor: people.academy, now,
            classes: [{ date: '2027-08-09', startTime: '08:30', roomId: ids.salon }],
        }), (error) => /^choque_/.test(error.code));
        assert.equal(await models.Payment.count(), before);
        // Another teacher cannot book them
        const andres = await models.User.create({ name: 'Andrés', email: 'andres@t.co', password: 'clave-de-prueba-1', role: 'teacher', cityId: people.laura.cityId });
        await assert.rejects(
            billing.scheduleSingleClass({ paymentId: five.payment.id, actor: andres, roomId: ids.salon, startsAt: toUtc('2027-08-16', '08:00'), now }),
            { code: 'sin_permiso' }
        );
    });
    test('cambiar el horario desde una clase mueve esa y las siguientes; las anteriores y la clase suelta se quedan', async () => {
        const student = await models.User.create({
            name: 'Noviembre', email: 'noviembre@t.co', password: 'clave-de-prueba-1', role: 'student', teacherId: people.laura.id, cityId: people.laura.cityId,
        });
        const fixed = await models.FixedSchedule.create({
            studentId: student.id, teacherId: people.laura.id, roomId: ids.salon, weekday: 2, startTime: '12:00', durationMinutes: 60, validFrom: '2027-11-01',
        });
        const now = toUtc('2027-11-01', '08:00');
        await billing.chargeMonth({ student, period: '2027-11', now });
        await billing.bookSingleClasses({
            studentId: student.id, period: '2027-11', count: 1, actor: people.academy, now,
            classes: [{ date: '2027-11-25', startTime: '12:00', roomId: ids.salon }],
        });
        assert.deepEqual(await datesOf(student.id, '2027-11'), ['2027-11-02', '2027-11-09', '2027-11-16', '2027-11-23', '2027-11-25']);

        // The teacher taps the last weekly class (the 23rd) and moves the weekly time to Wednesdays
        const tapped = await models.Lesson.findOne({ where: { studentId: student.id, startsAt: toUtc('2027-11-23', '12:00') } });
        const { movedLessons, fixed: changed } = await fixedSchedules.changeFixedSchedule({
            id: fixed.id, data: { weekday: 3, startTime: '12:00', moveUpcoming: true, fromLessonId: tapped.id }, actor: people.laura, now,
        });
        assert.equal(movedLessons.length, 1, 'solo la clase tocada (no hay más clases semanales después)');
        assert.deepEqual(await datesOf(student.id, '2027-11'), ['2027-11-02', '2027-11-09', '2027-11-16', '2027-11-24', '2027-11-25']);
        assert.equal(changed.validFrom, '2027-11-22', 'el nuevo horario rige desde la semana de la clase tocada');
        assert.equal((await models.FixedSchedule.findByPk(fixed.id)).validTo, '2027-11-21');

        // Without a tapped class every weekly class ahead moves, but never the single class
        const { movedLessons: all } = await fixedSchedules.changeFixedSchedule({
            id: changed.id, data: { weekday: 1, startTime: '12:00', moveUpcoming: true }, actor: people.laura, now: toUtc('2027-11-10', '08:00'),
        });
        assert.equal(all.length, 2);
        assert.deepEqual(await datesOf(student.id, '2027-11'), ['2027-11-02', '2027-11-09', '2027-11-15', '2027-11-22', '2027-11-25']);
    });

    test('3. marzo de 2027 tiene cinco martes: 260.000, clases el 2, 9, 16 y 23; el 30 queda para reposición', async () => {
        await models.FixedSchedule.create({
            studentId: people.Marta.id, teacherId: people.laura.id, roomId: ids.salon, weekday: 2, startTime: '17:00', durationMinutes: 60, validFrom: '2027-01-01',
        });
        await billing.chargeMonth({ student: people.Marta, period: '2027-03', now: toUtc('2027-03-01', '06:00') });
        const march = await models.Payment.findOne({ where: { studentId: people.Marta.id, period: '2027-03' } });
        assert.equal(march.amount, 260000);
        assert.deepEqual(await datesOf(people.Marta.id, '2027-03'), ['2027-03-02', '2027-03-09', '2027-03-16', '2027-03-23']);
    });

    test('la 5.ª semana es un cupo de reposición extra: Marta puede cambiar su clase al martes 30 a su misma hora', async () => {
        // March is paid (after the 5th, an unpaid month would not let her change classes)
        await models.Payment.update({ status: 'aprobado' }, { where: { studentId: people.Marta.id, period: '2027-03' } });
        const lesson = await models.Lesson.findOne({ where: { studentId: people.Marta.id, startsAt: toUtc('2027-03-23', '17:00') } });
        const now = toUtc('2027-03-20', '09:00');
        const { rule, options } = await lessons.getRescheduleOptions({ lessonId: lesson.id, actor: people.Marta, now });
        assert.equal(rule.ok, true);
        const fifth = options.find(o => o.fixedScheduleId);
        assert.ok(fifth, 'ofrece el martes 30');
        assert.equal(localParts(fifth.startsAt).date, '2027-03-30');
        assert.equal(localParts(fifth.startsAt).time, '17:00');

        const { makeup } = await lessons.rescheduleLesson({ lessonId: lesson.id, actor: people.Marta, fixedScheduleId: fifth.fixedScheduleId, startsAt: fifth.startsAt, now });
        assert.equal(localParts(makeup.startsAt).date, '2027-03-30');
        assert.equal(makeup.period, '2027-03');
        // Another time that is not a 5th-week slot is refused
        const other = await models.Lesson.findOne({ where: { studentId: people.Marta.id, startsAt: toUtc('2027-03-16', '17:00') } });
        await assert.rejects(
            lessons.rescheduleLesson({ lessonId: other.id, actor: people.Marta, fixedScheduleId: fifth.fixedScheduleId, startsAt: toUtc('2027-03-23', '17:00'), now: toUtc('2027-03-10', '09:00') }),
            { code: 'franja_invalida' }
        );
    });

    test('7. un descuento pendiente se aplica en la siguiente mensualidad', async () => {
        await models.PaymentAdjustment.create({
            studentId: people.Marta.id, kind: 'descuento_clase_no_repuesta', amount: -65000, reason: 'Clase no repuesta a tiempo',
        });
        await billing.chargeMonth({ student: people.Marta, period: '2027-04', now: toUtc('2027-04-01', '06:00') });
        const april = await models.Payment.findOne({ where: { studentId: people.Marta.id, period: '2027-04' } });
        assert.equal(april.amount, 195000);
        assert.equal(april.calculation.discounts.length, 1);
        assert.equal((await models.PaymentAdjustment.findOne({ where: { studentId: people.Marta.id } })).appliedPaymentId, april.id);
    });

    test('si no paga antes del día 6: no agenda, su horario queda libre y la clase que tomó se cobra como suelta', async () => {
        const { paymentStanding } = require('../domain/billing');
        const { Op } = require('sequelize');
        // Everything before June is paid
        await models.Payment.update({ status: 'aprobado' }, { where: { period: { [Op.lt]: '2027-06' } } });
        await billing.chargeMonth({ student: people.Marta, period: '2027-06', now: toUtc('2027-06-01', '06:00') });
        // Pedro pays on time: his receipt is under review on day 6
        await models.FixedSchedule.create({
            studentId: people.Pedro.id, teacherId: people.laura.id, roomId: ids.salon, weekday: 2, startTime: '18:00', durationMinutes: 60, validFrom: '2027-01-01',
        });
        await billing.chargeMonth({ student: people.Pedro, period: '2027-06', now: toUtc('2027-06-01', '06:00') });
        await models.Payment.update({ status: 'en_revision' }, { where: { studentId: people.Pedro.id, period: '2027-06' } });

        // Marta took her class on Tuesday June 1st
        await models.Lesson.update({ status: 'tomada' }, { where: { studentId: people.Marta.id, startsAt: toUtc('2027-06-01', '17:00') } });

        assert.equal(await billing.isBlockedByPayment(people.Marta.id, '2027-06', { now: toUtc('2027-06-05', '20:00') }), false);
        assert.equal(await billing.enforcePaymentDeadlines(toUtc('2027-06-05', '23:00')), 0);
        assert.equal(await billing.isBlockedByPayment(people.Marta.id, '2027-06', { now: toUtc('2027-06-06', '00:30') }), true);

        assert.equal(await billing.enforcePaymentDeadlines(toUtc('2027-06-06', '00:30')), 1);
        const june = await models.Payment.findOne({ where: { studentId: people.Marta.id, period: '2027-06', type: 'mensualidad' } });
        assert.equal(june.status, 'anulado');
        const debt = await models.Payment.findOne({ where: { studentId: people.Marta.id, type: 'clase_suelta' } });
        assert.equal(debt.amount, 65000);
        assert.equal(debt.calculation.debt, true);
        assert.deepEqual(await datesOf(people.Marta.id, '2027-06'), ['2027-06-01'], 'las clases siguientes se quitaron');
        const fixed = await models.FixedSchedule.findOne({ where: { studentId: people.Marta.id } });
        assert.equal(fixed.validTo, '2027-06-05');

        // Pedro, with his receipt under review, keeps his time
        assert.equal((await models.Payment.findOne({ where: { studentId: people.Pedro.id, period: '2027-06' } })).status, 'en_revision');
        assert.equal(paymentStanding({ payment: { status: 'en_revision', dueDate: '2027-06-05' }, now: toUtc('2027-06-06', '00:30'), settings: {} }).blocks, false);

        // If she comes back, she first pays what she owes
        await assert.rejects(
            assign(people.Marta, { weekday: 4, startTime: '10:00', validFrom: '2027-06-10' }, toUtc('2027-06-08', '10:00')),
            (error) => {
                assert.equal(error.code, 'deuda_pendiente');
                assert.match(error.message, /tiene \$65\.000 pendientes de clases que tomó sin pagar/);
                return true;
            }
        );
    });
});
