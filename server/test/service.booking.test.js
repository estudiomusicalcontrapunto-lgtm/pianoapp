const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupDatabase, teardownDatabase } = require('./helpers');
const { toUtc, localParts } = require('../domain/time');

let models;
let services;
const people = {};
const rooms = {};
const windows = {};

// Lunes 2 de noviembre de 2026, 8:00 en Bogotá
const NOW = toUtc('2026-11-02', '08:00');

const lessonsOf = (studentId) =>
    models.Lesson.findAll({ where: { studentId }, order: [['startsAt', 'ASC']] });

const lessonOn = async (studentId, date) =>
    (await lessonsOf(studentId)).find(l => localParts(l.startsAt).date === date);

const expectDomainError = async (promise, code) => {
    await assert.rejects(promise, (error) => {
        assert.equal(error.name, 'DomainError', error.stack);
        assert.equal(error.code, code);
        return true;
    });
};

describe('servicios de reservas', () => {
    before(async () => {
        models = await setupDatabase();
        services = {
            ...require('../services/lessonService'),
            ...require('../services/cycleService'),
        };
        const { User, Room, TeacherRoom, Availability, FixedSchedule, Cycle } = models;
        const pwd = 'clave-de-prueba-1';

        people.academy = await User.create({ name: 'Academia', email: 'a@t.co', password: pwd, role: 'academy' });
        people.laura = await User.create({ name: 'Laura', email: 'laura@t.co', password: pwd, role: 'teacher' });
        people.andres = await User.create({ name: 'Andrés', email: 'andres@t.co', password: pwd, role: 'teacher' });
        people.sofia = await User.create({ name: 'Sofía', email: 'sofia@t.co', password: pwd, role: 'student', teacherId: people.laura.id });
        people.valen = await User.create({ name: 'Valentina', email: 'valen@t.co', password: pwd, role: 'student', teacherId: people.laura.id });
        people.julian = await User.create({ name: 'Julián', email: 'julian@t.co', password: pwd, role: 'student', teacherId: people.laura.id });

        rooms.salon2 = await Room.create({ name: 'Salón 2' });
        await TeacherRoom.create({ teacherId: people.laura.id, roomId: rooms.salon2.id });
        await TeacherRoom.create({ teacherId: people.andres.id, roomId: rooms.salon2.id });

        const window = (teacher, weekday, startTime, endTime, type) =>
            Availability.create({ teacherId: teacher.id, roomId: rooms.salon2.id, weekday, startTime, endTime, type, capacity: 1 });
        windows.lauraWednesday = await window(people.laura, 3, '14:00', '18:00', 'clase');
        windows.lauraSaturday = await window(people.laura, 6, '09:00', '10:00', 'reposicion');
        windows.andresSaturday = await window(people.andres, 6, '10:00', '11:00', 'reposicion');

        const fixed = (student, startTime) => FixedSchedule.create({
            studentId: student.id, teacherId: people.laura.id, roomId: rooms.salon2.id,
            weekday: 3, startTime, durationMinutes: 60, validFrom: '2026-10-01',
        });
        await fixed(people.sofia, '15:00');
        await fixed(people.valen, '16:00');
        await fixed(people.julian, '17:00');

        for (const student of [people.sofia, people.valen, people.julian]) {
            people[`cycle_${student.name}`] = await Cycle.create({
                studentId: student.id, startDate: '2026-11-02', endDate: '2026-11-29',
                plan: 'paquete_4', classesIncluded: 4, amount: 260000,
            });
        }
    });

    after(async () => {
        await teardownDatabase();
    });

    test('confirmar el pago activa el ciclo y genera sus 4 clases', async () => {
        for (const student of [people.sofia, people.valen]) {
            const { cycle, lessons } = await services.confirmCyclePayment({
                cycleId: people[`cycle_${student.name}`].id, actor: people.academy, now: NOW,
            });
            assert.equal(cycle.status, 'activo');
            assert.equal(cycle.paymentStatus, 'pagado');
            assert.equal(lessons.length, 4);
        }
        const sofia = await lessonsOf(people.sofia.id);
        assert.deepEqual(sofia.map(l => localParts(l.startsAt).date), ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
    });

    test('un pago confirmado tarde corre el inicio del ciclo a la próxima clase', async () => {
        const { cycle, lessons } = await services.confirmCyclePayment({
            cycleId: people.cycle_Julián.id, actor: people.academy, now: toUtc('2026-11-04', '18:00'),
        });
        assert.equal(cycle.startDate, '2026-11-11');
        assert.equal(cycle.endDate, '2026-12-08');
        assert.equal(localParts(lessons[0].startsAt).date, '2026-11-11');
    });

    test('dos reservas simultáneas del mismo cupo: solo una gana', async () => {
        const sofiaLesson = await lessonOn(people.sofia.id, '2026-11-11');
        const valenLesson = await lessonOn(people.valen.id, '2026-11-11');
        const slot = toUtc('2026-11-07', '09:00');

        const results = await Promise.allSettled([
            services.rescheduleLesson({ lessonId: sofiaLesson.id, actor: people.sofia, availabilityId: windows.lauraSaturday.id, startsAt: slot, now: NOW }),
            services.rescheduleLesson({ lessonId: valenLesson.id, actor: people.valen, availabilityId: windows.lauraSaturday.id, startsAt: slot, now: NOW }),
        ]);

        const won = results.filter(r => r.status === 'fulfilled');
        const lost = results.filter(r => r.status === 'rejected');
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.equal(lost[0].reason.status, 409, lost[0].reason.stack);

        const booked = await models.Lesson.findAll({ where: { availabilityId: windows.lauraSaturday.id, startsAt: slot } });
        assert.equal(booked.length, 1);

        // The loser's lesson stays where it was and keeps its reschedule
        const loserId = won[0].value.original.studentId === people.sofia.id ? people.valen.id : people.sofia.id;
        const loserLesson = await lessonOn(loserId, '2026-11-11');
        assert.equal(loserLesson.status, 'programada');
        people.winner = won[0].value.original.studentId === people.sofia.id ? people.sofia : people.valen;
        people.loser = people.winner === people.sofia ? people.valen : people.sofia;
    });

    test('la reprogramación deja la original enlazada y en estado reprogramada_por_estudiante', async () => {
        const original = await lessonOn(people.winner.id, '2026-11-11');
        assert.equal(original.status, 'reprogramada_por_estudiante');
        const makeup = await models.Lesson.findOne({ where: { originalLessonId: original.id } });
        assert.equal(makeup.kind, 'reposicion');
        assert.equal(makeup.status, 'programada');
        const audit = await models.AuditLog.findAll({ where: { entityId: original.id } });
        assert.equal(audit[0].toStatus, 'reprogramada_por_estudiante');
    });

    test('sin tope mensual, el alumno puede cambiar otra clase del mes', async () => {
        const lesson = await lessonOn(people.winner.id, '2026-11-18');
        const { makeup } = await services.rescheduleLesson({
            lessonId: lesson.id, actor: people.winner, availabilityId: windows.lauraSaturday.id,
            startsAt: toUtc('2026-11-21', '09:00'), now: NOW,
        });
        assert.equal(localParts(makeup.startsAt).date, '2026-11-21');
        // A make-up cannot be changed again
        await expectDomainError(
            services.rescheduleLesson({
                lessonId: makeup.id, actor: people.winner, availabilityId: windows.lauraSaturday.id,
                startsAt: toUtc('2026-11-28', '09:00'), now: NOW,
            }),
            'reposicion_no_cambia'
        );
    });

    test('una cancelación del profesor deja la reposición pendiente y la agenda el profesor, no el alumno', async () => {
        const toCancel = await lessonOn(people.loser.id, '2026-11-18');
        const [cancelled] = await services.cancelLessons({ lessonIds: [toCancel.id], actor: people.laura, reason: 'Concierto', now: NOW });
        assert.equal(cancelled.status, 'cancelada_por_profesor');

        // The student's other classes can still be changed; Saturdays 7 and 21 are taken, 14 and 28 remain in November
        const options = await services.getRescheduleOptions({ lessonId: (await lessonOn(people.loser.id, '2026-11-25')).id, actor: people.loser, now: NOW });
        assert.equal(options.rule.ok, true);
        assert.equal(options.month, '2026-11');
        assert.deepEqual(options.options.map(o => localParts(o.startsAt).date), ['2026-11-14', '2026-11-28']);

        // The student does not book the owed make-up: the teacher does
        await expectDomainError(
            services.bookMakeup({
                lessonId: toCancel.id, actor: people.loser, availabilityId: windows.lauraSaturday.id,
                startsAt: toUtc('2026-11-14', '09:00'), now: NOW,
            }),
            'reposicion_del_profesor'
        );
        const { makeup } = await services.bookMakeup({
            lessonId: toCancel.id, actor: people.laura, availabilityId: windows.lauraSaturday.id,
            startsAt: toUtc('2026-11-14', '09:00'), now: NOW,
        });
        assert.equal(makeup.originalLessonId, toCancel.id);

        // ...and only once
        await expectDomainError(
            services.bookMakeup({
                lessonId: toCancel.id, actor: people.laura, roomId: rooms.salon2.id,
                startsAt: toUtc('2026-11-20', '18:00'), now: NOW,
            }),
            'reposicion_ya_agendada'
        );
    });

    test('la reposición que debe el profesor no puede pasar del final del mes siguiente', async () => {
        // Julián's class of Wednesday November 11th: its make-up can be given until December 31st
        const toCancel = await lessonOn(people.julian.id, '2026-11-11');
        await services.cancelLessons({ lessonIds: [toCancel.id], actor: people.laura, now: NOW });
        await expectDomainError(
            services.bookMakeup({ lessonId: toCancel.id, actor: people.laura, roomId: rooms.salon2.id, startsAt: toUtc('2027-01-06', '18:00'), now: NOW }),
            'despues_del_plazo'
        );
    });

    test('el profesor puede agendar la reposición que debe en cualquier hueco libre, aun después del vencimiento', async () => {
        const toCancel = await lessonOn(people.winner.id, '2026-11-25');
        await services.cancelLessons({ lessonIds: [toCancel.id], actor: people.laura, now: NOW });

        // 17:30 would overlap Julián's fixed Wednesday 17:00 class
        await expectDomainError(
            services.bookMakeup({
                lessonId: toCancel.id, actor: people.laura, roomId: rooms.salon2.id,
                startsAt: toUtc('2026-12-02', '17:30'), now: NOW,
            }),
            'choque_salon'
        );

        const { makeup } = await services.bookMakeup({
            lessonId: toCancel.id, actor: people.laura, roomId: rooms.salon2.id,
            startsAt: toUtc('2026-12-02', '18:00'), now: NOW,
        });
        assert.equal(localParts(makeup.startsAt).date, '2026-12-02');
        assert.equal(makeup.availabilityId, null);
    });

    test('un choque de salón con la franja de otro profesor falla', async () => {
        const toCancel = await lessonOn(people.loser.id, '2026-11-25');
        await services.cancelLessons({ lessonIds: [toCancel.id], actor: people.laura, now: NOW });
        await expectDomainError(
            services.bookMakeup({
                lessonId: toCancel.id, actor: people.laura, roomId: rooms.salon2.id,
                startsAt: toUtc('2026-11-14', '10:00'), now: NOW,
            }),
            'choque_salon'
        );
    });

    test('el estudiante no agenda reposiciones de clases que canceló el profesor, ni en un hueco libre', async () => {
        const owed = await lessonOn(people.loser.id, '2026-11-25');
        await expectDomainError(
            services.bookMakeup({
                lessonId: owed.id, actor: people.loser, roomId: rooms.salon2.id,
                startsAt: toUtc('2026-11-20', '17:00'), now: NOW,
            }),
            'reposicion_del_profesor'
        );
    });

    test('el profesor mueve una clase sin la regla de 12 horas, dentro del mes', async () => {
        const target = await lessonOn(people.julian.id, '2026-11-18');
        // 30 minutes before the class
        const now = new Date(new Date(target.startsAt).getTime() - 30 * 60000);
        await expectDomainError(
            services.moveLesson({ lessonId: target.id, actor: people.laura, startsAt: toUtc('2026-12-02', '18:00'), now }),
            'fuera_del_mes'
        );
        const { makeup } = await services.moveLesson({ lessonId: target.id, actor: people.laura, startsAt: toUtc('2026-11-19', '18:00'), now });
        assert.equal(localParts(makeup.startsAt).date, '2026-11-19');
        assert.equal((await models.Lesson.findByPk(target.id)).moved, true);
    });

    test('permisos: cada quien solo actúa sobre lo suyo', async () => {
        const sofiaLesson = await lessonOn(people.sofia.id, '2026-11-04');
        await expectDomainError(
            services.cancelLessons({ lessonIds: [sofiaLesson.id], actor: people.andres, now: NOW }),
            'sin_permiso'
        );
        await expectDomainError(
            services.getRescheduleOptions({ lessonId: sofiaLesson.id, actor: people.valen, now: NOW }),
            'sin_permiso'
        );
        await expectDomainError(
            services.getRescheduleOptions({ lessonId: sofiaLesson.id, actor: people.laura, now: NOW }),
            'sin_permiso'
        );
    });

    test('la asistencia se marca después de empezar la clase', async () => {
        const lesson = await lessonOn(people.sofia.id, '2026-11-04');
        await expectDomainError(
            services.markAttendance({ lessonId: lesson.id, actor: people.laura, status: 'tomada', now: NOW }),
            'clase_futura'
        );
        const marked = await services.markAttendance({
            lessonId: lesson.id, actor: people.laura, status: 'tomada', now: toUtc('2026-11-04', '16:00'),
        });
        assert.equal(marked.status, 'tomada');
    });
});
