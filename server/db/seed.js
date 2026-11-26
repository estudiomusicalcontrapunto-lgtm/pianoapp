// Sample data for local development: `npm run seed`.
// Safe to run twice: existing emails and rooms are skipped.
// To keep your current data apart, point it at another file:
//   DB_STORAGE=./seed.sqlite npm run seed
require('dotenv').config();

const { runMigrations } = require('./migrator');
const { sequelize, User, Room, TeacherRoom, Availability, FixedSchedule, Cycle, Lesson, Assessment, Instrument, TeacherInstrument, City } = require('../models');
const { confirmCyclePayment } = require('../services/cycleService');
const { cancelLessons, markAttendance } = require('../services/lessonService');
const { getSettings } = require('../services/settingsService');
const { computeEndDate } = require('../domain/cycles');
const { computeHoldExpiry } = require('../domain/holds');
const { localDate, addDays, weekdayOf, toUtc } = require('../domain/time');

// Local test password for every seeded account (never use it in production)
const SEED_PASSWORD = 'Contrapunto-2026';

// The migration creates Pereira; every seeded student, teacher and room is there
const pereiraId = async () => (await City.findOne({ where: { name: 'Pereira' } })).id;

const findOrCreateUser = async (data) => {
    const existing = await User.findOne({ where: { email: data.email } });
    if (existing) return existing;
    const cityId = data.role === 'academy' ? null : await pereiraId();
    return User.create({ password: SEED_PASSWORD, cityId, ...data });
};

const findOrCreateRoom = async (name, capacity = 1) => {
    const cityId = await pereiraId();
    const [room] = await Room.findOrCreate({ where: { name, cityId }, defaults: { capacity } });
    return room;
};

const assignRoom = (teacher, room) =>
    TeacherRoom.findOrCreate({ where: { teacherId: teacher.id, roomId: room.id } });

const findOrCreateInstrument = async (name) => {
    const [instrument] = await Instrument.findOrCreate({ where: { name } });
    return instrument;
};

const assignInstrument = (teacher, instrument) =>
    TeacherInstrument.findOrCreate({ where: { teacherId: teacher.id, instrumentId: instrument.id } });

const addAvailability = async (teacher, room, weekday, startTime, endTime, type) => {
    const where = { teacherId: teacher.id, roomId: room.id, weekday, startTime, endTime, type };
    await Availability.findOrCreate({ where, defaults: { capacity: 1 } });
};

const seed = async () => {
    await runMigrations();

    await findOrCreateUser({ name: 'Academia Contrapunto', email: 'academia@contrapunto.test', role: 'academy' });

    const laura = await findOrCreateUser({ name: 'Laura Gómez', email: 'laura@contrapunto.test', role: 'teacher' });
    const andres = await findOrCreateUser({ name: 'Andrés Ríos', email: 'andres@contrapunto.test', role: 'teacher' });

    // The migration creates Piano; Andrés also teaches guitar
    const piano = await findOrCreateInstrument('Piano');
    const guitarra = await findOrCreateInstrument('Guitarra');
    await assignInstrument(laura, piano);
    await assignInstrument(andres, piano);
    await assignInstrument(andres, guitarra);

    const salon1 = await findOrCreateRoom('Salón 1');
    const salon2 = await findOrCreateRoom('Salón 2');
    const salon3 = await findOrCreateRoom('Salón 3');

    // Laura and Andrés share Salón 2
    await assignRoom(laura, salon1);
    await assignRoom(laura, salon2);
    await assignRoom(andres, salon2);
    await assignRoom(andres, salon3);

    // Make-up windows (1 = lunes ... 6 = sábado). Classes are placed directly
    // on the calendar, so there are no class windows.
    await addAvailability(laura, salon2, 6, '09:00', '10:00', 'reposicion');
    await addAvailability(laura, salon2, 6, '10:00', '11:00', 'reposicion');
    await addAvailability(andres, salon3, 5, '15:00', '16:00', 'reposicion');
    await addAvailability(andres, salon2, 6, '11:00', '12:00', 'reposicion');

    // Two minors (guardian contact only; the parent uses the student's account) and two adults
    const sofia = await findOrCreateUser({
        name: 'Sofía Martínez', email: 'sofia@contrapunto.test', role: 'student', teacherId: laura.id, instrumentId: piano.id,
        birthDate: '2015-04-12', guardianName: 'Carolina Martínez', guardianPhone: '3001234567', level: '2',
    });
    const tomas = await findOrCreateUser({
        name: 'Tomás Martínez', email: 'tomas@contrapunto.test', role: 'student', teacherId: andres.id, instrumentId: piano.id,
        birthDate: '2017-09-03', guardianName: 'Carolina Martínez', guardianPhone: '3001234567',
    });
    const valentina = await findOrCreateUser({
        name: 'Valentina Ospina', email: 'valentina@contrapunto.test', role: 'student', teacherId: laura.id, instrumentId: piano.id,
        birthDate: '1998-01-20', phone: '3109876543', level: '3',
    });
    const julian = await findOrCreateUser({
        name: 'Julián Cardona', email: 'julian@contrapunto.test', role: 'student', teacherId: andres.id, instrumentId: piano.id,
        birthDate: '1990-06-15', phone: '3157654321',
    });

    if (await Cycle.count() > 0) {
        console.log('Ya hay ciclos: se omiten horarios, ciclos y valoraciones de ejemplo.');
    } else {
        await seedSchedulesAndCycles({ laura, andres, salon1, salon2, sofia, tomas, valentina, julian });
    }

    console.log('Seed listo. Contraseña de todas las cuentas de prueba: ver SEED_PASSWORD en db/seed.js');
};

// Fixed schedules, cycles in every payment state and one held slot, relative to today
const seedSchedulesAndCycles = async ({ laura, andres, salon1, salon2, sofia, tomas, valentina, julian }) => {
    const now = new Date();
    const settings = await getSettings();
    const academy = await User.findOne({ where: { role: 'academy' } });
    const today = localDate(now);
    const thisMonday = addDays(today, 1 - weekdayOf(today));
    const validFrom = addDays(thisMonday, -63);

    const fixed = (student, teacher, room, weekday, startTime) => FixedSchedule.create({
        studentId: student.id, teacherId: teacher.id, roomId: room.id, weekday, startTime, durationMinutes: 60, validFrom,
    });
    await fixed(sofia, laura, salon2, 1, '09:00');
    await fixed(valentina, laura, salon2, 3, '10:00');
    await fixed(tomas, andres, salon2, 1, '15:00');
    await fixed(julian, andres, salon2, 4, '14:00');

    const createCycle = (student, startDate, extra = {}) => Cycle.create({
        studentId: student.id,
        startDate,
        endDate: computeEndDate(startDate, settings),
        plan: 'paquete_4',
        classesIncluded: 4,
        amount: settings.precio_paquete_4,
        ...extra,
    });

    // Lessons already given are marked as taken
    const markPastAsTaken = async (cycleId, teacher) => {
        const lessons = await Lesson.findAll({ where: { cycleId, status: 'programada' } });
        for (const lesson of lessons.filter(l => l.endsAt < now)) {
            await markAttendance({ lessonId: lesson.id, actor: teacher, status: 'tomada', now: lesson.endsAt });
        }
    };

    // Sofía: paid cycle that started last week (pagado / activo)
    const sofiaCycle = await createCycle(sofia, addDays(thisMonday, -7));
    await confirmCyclePayment({ cycleId: sofiaCycle.id, actor: academy, now, keepDates: true });
    await markPastAsTaken(sofiaCycle.id, laura);

    // Julián: a finished cycle and a current one with a lesson cancelled by the teacher
    const julianOld = await createCycle(julian, addDays(thisMonday, -35));
    await confirmCyclePayment({ cycleId: julianOld.id, actor: academy, now, keepDates: true });
    await markPastAsTaken(julianOld.id, andres);
    await julianOld.update({ status: 'finalizado' });

    const julianCycle = await createCycle(julian, addDays(julianOld.endDate, 1));
    await confirmCyclePayment({ cycleId: julianCycle.id, actor: academy, now, keepDates: true });
    await markPastAsTaken(julianCycle.id, andres);
    const nextJulian = await Lesson.findOne({ where: { cycleId: julianCycle.id, status: 'programada' }, order: [['startsAt', 'ASC']] });
    if (nextJulian) {
        await cancelLessons({ lessonIds: [nextJulian.id], actor: andres, reason: 'Concierto del profesor', now });
    }

    // Valentina: receipt uploaded, waiting for the academy (en_revision)
    await createCycle(valentina, addDays(thisMonday, 7), { paymentStatus: 'en_revision', receiptUploadedAt: now });

    // Tomás: an old cycle never paid (vencido) and the next one pending payment
    await createCycle(tomas, addDays(thisMonday, -28), { paymentStatus: 'vencido', status: 'cancelado' });
    await createCycle(tomas, addDays(thisMonday, 7));

    // A free assessment with Laura's Tuesday 15:00 slot held for 48 hours
    await Assessment.create({
        studentName: 'Mariana López',
        studentBirthDate: '2016-02-10',
        contactName: 'Andrea López',
        contactPhone: '3201112233',
        scheduledAt: toUtc(today, '11:00'),
        teacherId: laura.id,
        status: 'realizada',
        result: 'Nivel 1. Buena coordinación, sin lectura musical.',
        holdRoomId: salon1.id,
        holdWeekday: 2,
        holdStartTime: '15:00',
        holdDurationMinutes: 60,
        holdStatus: 'apartado',
        holdExpiresAt: computeHoldExpiry(now, settings),
    });
};

seed()
    .then(() => sequelize.close())
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
