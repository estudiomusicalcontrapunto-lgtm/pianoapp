// The academy's cases for the monthly billing (2026-11-24), on the real calendar.
// Pereira: mensualidad 260.000, clase suelta 65.000.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS } = require('../domain/settings');
const { resolvePrices } = require('../domain/pricing');
const { monthlyClassPlan, occurrencesInMonth } = require('../domain/monthly');
const { monthlyCharge, firstCharge, singleClassCharge, paymentStanding, unpaidClassesDebt } = require('../domain/billing');
const {
    checkStudentChange, checkStudentMakeupTarget, checkTeacherMove, pendingMakeupDeadline, isPendingMakeupExpired, planPendingMakeupExpiry,
} = require('../domain/classRules');
const { planClassOverWindows, describeWindowLoss, bookedMakeupsLeftOut } = require('../domain/makeupWindows');
const { findWeeklyConflict, findDatedConflict } = require('../domain/conflicts');
const { toUtc, addMinutes, weekdayOf } = require('../domain/time');

const settings = { ...DEFAULT_SETTINGS };
const prices = resolvePrices({ city: { monthlyFee: 260000, singleClassFee: null } });
const TUESDAY = 2;

test('Pereira: 260.000 la mensualidad y 65.000 la clase suelta', () => {
    assert.equal(prices.monthlyFee, 260000);
    assert.equal(prices.singleClassFee, 65000);
});

test('el calendario es el real: martes 15 de junio de 2027, jueves 28 de enero de 2027, martes 2 de marzo de 2027', () => {
    assert.equal(weekdayOf('2027-06-15'), 2);
    assert.equal(weekdayOf('2027-01-28'), 4);
    assert.equal(weekdayOf('2027-03-02'), 2);
    assert.equal(weekdayOf('2026-12-01'), 2);
});

test('1. alumno que entra el martes 15 de junio de 2027: 3 × 65.000 = 195.000; desde el 1 de julio paga 260.000', () => {
    const result = firstCharge({ startDate: '2027-06-15', weekday: TUESDAY, prices, settings });
    assert.equal(result.suggestNextMonth, false);
    assert.deepEqual(result.charge.calculation.dates, ['2027-06-15', '2027-06-22', '2027-06-29']);
    assert.equal(result.charge.type, 'proporcional');
    assert.equal(result.charge.amount, 195000);
    assert.equal(result.charge.calculation.capped, false);
    assert.deepEqual(result.classes, ['2027-06-15', '2027-06-22', '2027-06-29']);
    // 3 days to pay from the day the teacher gave the time
    assert.equal(result.charge.dueDate, '2027-06-18');

    const july = monthlyCharge({ period: '2027-07', prices, settings });
    assert.equal(july.type, 'mensualidad');
    assert.equal(july.amount, 260000);
    assert.equal(july.dueDate, '2027-07-05');
});

test('2. alumno que entra el último jueves (28 de enero de 2027): se sugiere empezar el 1 de febrero', () => {
    const result = firstCharge({ startDate: '2027-01-28', weekday: 4, prices, settings });
    assert.equal(result.suggestNextMonth, true);
    assert.deepEqual(result.remaining, ['2027-01-28']);
    // If accepted: 260.000 on February 1st, first class Thursday February 4th
    assert.equal(result.nextMonthStart, '2027-02-04');
    assert.equal(result.nextMonthCharge.period, '2027-02');
    assert.equal(result.nextMonthCharge.amount, 260000);
    assert.equal(result.nextMonthCharge.dueDate, '2027-02-05');
    // If they start on the 28th anyway: that class is a clase suelta
    assert.equal(result.startAnyway.type, 'clase_suelta');
    assert.equal(result.startAnyway.lessonDate, '2027-01-28');
    assert.equal(result.startAnyway.amount, 65000);
});

test('2b. sin clases restantes en el mes también se sugiere el mes siguiente, sin clase suelta', () => {
    // Friday January 29th 2027: the class day (Thursday) does not fall again in January
    const result = firstCharge({ startDate: '2027-01-29', weekday: 4, prices, settings });
    assert.equal(result.suggestNextMonth, true);
    assert.equal(result.startAnyway, null);
    assert.equal(result.nextMonthStart, '2027-02-04');
});

test('3. marzo de 2027 tiene cinco martes: el alumno fijo paga 260.000 y la semana del 30 queda para reposición', () => {
    assert.deepEqual(occurrencesInMonth('2027-03', TUESDAY), ['2027-03-02', '2027-03-09', '2027-03-16', '2027-03-23', '2027-03-30']);
    const plan = monthlyClassPlan({ period: '2027-03', fixed: { weekday: TUESDAY, validFrom: '2026-01-01' } });
    assert.deepEqual(plan.classes, ['2027-03-02', '2027-03-09', '2027-03-16', '2027-03-23']);
    assert.deepEqual(plan.makeupWeeks, ['2027-03-30']);
    assert.equal(monthlyCharge({ period: '2027-03', prices, settings }).amount, 260000);
});

test('3b. alumno nuevo desde el martes 2 de marzo: 5 × 65.000 = 325.000, con el tope paga 260.000', () => {
    const result = firstCharge({ startDate: '2027-03-02', weekday: TUESDAY, prices, settings });
    assert.equal(result.charge.calculation.uncapped, 325000);
    assert.equal(result.charge.calculation.capped, true);
    assert.equal(result.charge.amount, 260000);
    // Like everyone, the 5th week is for make-ups
    assert.deepEqual(result.classes, ['2027-03-02', '2027-03-09', '2027-03-16', '2027-03-23']);
    assert.deepEqual(result.makeupWeeks, ['2027-03-30']);
});

test('3c. con monthlyFeeCoversAllClasses activo, la 5.ª semana también es clase y se paga lo mismo', () => {
    const coversAll = { ...settings, mensualidad_cubre_todas_las_clases: true };
    const plan = monthlyClassPlan({ period: '2027-03', fixed: { weekday: TUESDAY }, coversAll: true });
    assert.equal(plan.classes.length, 5);
    assert.deepEqual(plan.makeupWeeks, []);
    const result = firstCharge({ startDate: '2027-03-02', weekday: TUESDAY, prices, settings: coversAll });
    assert.equal(result.charge.amount, 260000);
    assert.equal(result.classes.length, 5);
});

test('4. un lunes festivo cuenta como clase normal en el cobro proporcional', () => {
    // Monday January 11th 2027 is a holiday (Reyes Magos, moved to Monday): it counts
    const result = firstCharge({ startDate: '2027-01-11', weekday: 1, prices, settings });
    assert.deepEqual(result.charge.calculation.dates, ['2027-01-11', '2027-01-18', '2027-01-25']);
    assert.equal(result.charge.amount, 195000);
    // And in the month plan it is a class like any other
    assert.deepEqual(monthlyClassPlan({ period: '2027-01', fixed: { weekday: 1 } }).classes, ['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']);
});

test('5. transición de diciembre de 2026: los martes 15, 22 y 29 como sueltas y desde enero la mensualidad', () => {
    const sueltas = ['2026-12-15', '2026-12-22', '2026-12-29'].map(lessonDate => singleClassCharge({ lessonDate, prices }));
    assert.deepEqual(sueltas.map(s => [s.type, s.lessonDate, s.amount]), [
        ['clase_suelta', '2026-12-15', 65000],
        ['clase_suelta', '2026-12-22', 65000],
        ['clase_suelta', '2026-12-29', 65000],
    ]);

    // The pending make-up is taken in December: on January 1st it is gone
    const pending = { id: 'r1', startsAt: toUtc('2026-12-08', '16:00'), status: 'reprogramada_por_estudiante' };
    assert.equal(pendingMakeupDeadline(pending), '2026-12-31');
    assert.equal(isPendingMakeupExpired(pending, toUtc('2026-12-31', '20:00')), false);
    assert.equal(isPendingMakeupExpired(pending, toUtc('2027-01-01', '00:00')), true);

    const january = monthlyCharge({ period: '2027-01', prices, settings });
    assert.equal(january.amount, 260000);
    assert.equal(january.dueDate, '2027-01-05');
    assert.deepEqual(monthlyClassPlan({ period: '2027-01', fixed: { weekday: TUESDAY } }).classes, ['2027-01-05', '2027-01-12', '2027-01-19', '2027-01-26']);
});

// A Wednesday 16 June 2027 class at 7:00 a.m.: it can be changed until Tuesday 15 at 7:00 p.m.
const lesson = { id: 'l1', startsAt: toUtc('2027-06-16', '07:00'), endsAt: toUtc('2027-06-16', '08:00'), status: 'programada', kind: 'regular' };

test('6. regla de 12 horas: con 13 horas sí se puede cambiar, con 11 no', () => {
    const with13 = checkStudentChange({ lesson, now: toUtc('2027-06-15', '18:00'), settings });
    assert.equal(with13.ok, true);
    assert.equal(with13.message, 'Puedes cambiar esta clase hasta hoy a las 7:00 p.m.');

    const with11 = checkStudentChange({ lesson, now: toUtc('2027-06-15', '20:00'), settings });
    assert.equal(with11.ok, false);
    assert.equal(with11.code, 'plazo_vencido');
    assert.match(with11.message, /Ya pasó el plazo para cambiar esta clase: se podía hasta hoy a las 7:00 p\.m\./);

    // Exactly 12 hours before still counts
    assert.equal(checkStudentChange({ lesson, now: toUtc('2027-06-15', '19:00'), settings }).ok, true);
    // The days before, the message names the day
    assert.equal(
        checkStudentChange({ lesson, now: toUtc('2027-06-14', '09:00'), settings }).message,
        'Puedes cambiar esta clase hasta mañana a las 7:00 p.m.'
    );
});

test('6b. una reposición no se puede cambiar; se reponen en el mismo mes y con 12 horas de anticipación', () => {
    const makeup = { ...lesson, kind: 'reposicion' };
    assert.equal(checkStudentChange({ lesson: makeup, now: toUtc('2027-06-10', '09:00'), settings }).code, 'reposicion_no_cambia');

    const now = toUtc('2027-06-15', '09:00');
    assert.equal(checkStudentMakeupTarget({ original: lesson, startsAt: toUtc('2027-06-26', '10:00'), now, settings }).ok, true);
    assert.equal(checkStudentMakeupTarget({ original: lesson, startsAt: toUtc('2027-07-03', '10:00'), now, settings }).code, 'fuera_del_mes');
    // 11 hours ahead: too soon
    assert.equal(checkStudentMakeupTarget({ original: lesson, startsAt: toUtc('2027-06-15', '20:00'), now, settings }).code, 'reposicion_muy_pronto');
});

test('6c. tope mensual opcional: apagado por defecto; con tope 2, el tercer cambio no se permite', () => {
    const now = toUtc('2027-06-10', '09:00');
    assert.equal(checkStudentChange({ lesson, now, settings, changesThisMonth: 10 }).ok, true);
    const capped = checkStudentChange({ lesson, now, settings: { ...settings, tope_cambios_mes: 2 }, changesThisMonth: 2 });
    assert.equal(capped.code, 'tope_mensual');
    // Without accepting the current terms, or with the month unpaid after the deadline, no changes
    assert.equal(checkStudentChange({ lesson, now, settings, termsPending: true }).code, 'terminos_pendientes');
    assert.equal(checkStudentChange({ lesson, now, settings, paymentBlocked: true }).code, 'pago_vencido');
});

test('6d. el profesor puede mover la clase sin las 12 horas mientras no haya empezado, dentro del mes', () => {
    const now = toUtc('2027-06-16', '06:30'); // 30 minutes before
    assert.equal(checkTeacherMove({ lesson, startsAt: toUtc('2027-06-23', '07:00'), now }).ok, true);
    assert.equal(checkTeacherMove({ lesson, startsAt: toUtc('2027-07-07', '07:00'), now }).code, 'fuera_del_mes');
    assert.equal(checkTeacherMove({ lesson, startsAt: toUtc('2027-06-23', '07:00'), now: toUtc('2027-06-16', '07:05') }).code, 'clase_pasada');
});

test('7. fin de mes: la reposición del alumno desaparece el 1; la que debe el profesor dura hasta fin del mes siguiente', () => {
    const student = { id: 'a', studentId: 's1', startsAt: toUtc('2027-03-23', '16:00'), status: 'reprogramada_por_estudiante' };
    const teacher = { id: 'p', studentId: 's1', startsAt: toUtc('2027-03-23', '16:00'), status: 'cancelada_por_profesor' };
    const pricesOf = () => prices;

    const april1 = planPendingMakeupExpiry({ pending: [student, teacher], now: toUtc('2027-04-01', '00:00'), pricesOf });
    assert.deepEqual(april1.lost.map(l => l.id), ['a']);
    assert.deepEqual(april1.discounts, []);
    assert.equal(pendingMakeupDeadline(teacher), '2027-04-30');

    // Not given by April 30th: a single class is discounted from the next payment
    const may1 = planPendingMakeupExpiry({ pending: [teacher], now: toUtc('2027-05-01', '00:00'), pricesOf });
    assert.equal(may1.discounts.length, 1);
    assert.equal(may1.discounts[0].amount, -65000);
    assert.equal(may1.discounts[0].kind, 'descuento_clase_no_repuesta');
    assert.equal(monthlyCharge({ period: '2027-05', prices, settings, discounts: may1.discounts }).amount, 195000);

    // A class the teacher only moved is not a cancellation
    assert.equal(pendingMakeupDeadline({ ...teacher, moved: true }), '2027-03-31');
});

test('8. salones: una clase nueva ocupa una franja de reposición libre, pero no una con un alumno agendado', () => {
    const laurasWindow = { id: 'w1', teacherId: 'laura', roomId: 'salon2', weekday: 6, startTime: '09:00', endTime: '11:00', type: 'reposicion', active: true };
    const andresClass = { kind: 'fixed', weekday: 6, startTime: '09:00', endTime: '10:00', roomId: 'salon2', teacherId: 'andres', studentId: 'nuevo', validFrom: '2027-06-01' };
    const now = toUtc('2027-06-01', '08:00');
    const ctx = { availabilities: [laurasWindow], fixedSchedules: [], lessons: [], holds: [], now };

    // The window does not block the new class (it yields), and shrinks to 10:00-11:00
    assert.ok(findWeeklyConflict(andresClass, ctx));
    assert.equal(findWeeklyConflict(andresClass, ctx, { windowsYield: true }), null);
    const free = planClassOverWindows({ candidate: andresClass, windows: [laurasWindow], lessons: [], now });
    assert.equal(free.ok, true);
    assert.deepEqual(free.windowChanges[0].remaining, [{ startTime: '10:00', endTime: '11:00' }]);
    assert.match(describeWindowLoss(free.windowChanges[0]), /lo ocupó en parte una clase fija nueva\. Queda de 10:00 a 11:00/);

    // A student already booked in that window at 9:00 on Saturday June 12th: it is respected
    const booked = { id: 'm1', availabilityId: 'w1', studentId: 'sofia', teacherId: 'laura', roomId: 'salon2', status: 'programada', startsAt: toUtc('2027-06-12', '09:00'), endsAt: toUtc('2027-06-12', '10:00') };
    const taken = planClassOverWindows({ candidate: andresClass, windows: [laurasWindow], lessons: [booked], now, teacherNames: { laura: 'Laura' } });
    assert.equal(taken.ok, false);
    assert.equal(taken.code, 'reposicion_agendada');
    assert.match(taken.message, /franja de reposición de Laura y ya hay un estudiante agendado ahí el sábado 12 de junio, 09:00/);

    // A booking at 10:00 does not touch the 9:00 class
    const later = { ...booked, startsAt: toUtc('2027-06-12', '10:00'), endsAt: toUtc('2027-06-12', '11:00') };
    assert.equal(planClassOverWindows({ candidate: andresClass, windows: [laurasWindow], lessons: [later], now }).ok, true);

    // Two classes in the same room at the same time: never
    const existing = { id: 'f1', studentId: 'otro', teacherId: 'laura', roomId: 'salon2', weekday: 6, startTime: '09:00', durationMinutes: 60, validFrom: '2027-01-01' };
    const conflict = findWeeklyConflict(andresClass, { ...ctx, fixedSchedules: [existing] }, { windowsYield: true });
    assert.equal(conflict.type, 'salon');
    const dated = findDatedConflict({ startsAt: toUtc('2027-06-12', '09:30'), endsAt: addMinutes(toUtc('2027-06-12', '09:30'), 60), roomId: 'salon2', teacherId: 'andres', studentId: 'x' }, { ...ctx, fixedSchedules: [existing] });
    assert.equal(dated.type, 'salon');
});

test('franja de reposición con alumnos agendados: no se quita ni se cambia si alguno queda por fuera', () => {
    const window = { id: 'w1', teacherId: 'laura', roomId: 'salon2', weekday: 6, startTime: '09:00', endTime: '11:00', type: 'reposicion', active: true };
    const now = toUtc('2027-06-01', '08:00');
    const booked = { id: 'm1', availabilityId: 'w1', roomId: 'salon2', status: 'programada', startsAt: toUtc('2027-06-12', '10:00'), endsAt: toUtc('2027-06-12', '11:00') };
    const past = { ...booked, id: 'm0', status: 'tomada', startsAt: toUtc('2027-05-29', '10:00'), endsAt: toUtc('2027-05-29', '11:00') };
    const otherWindow = { ...booked, id: 'm2', availabilityId: 'w9' };
    const lessons = [booked, past, otherWindow];

    // Removing it: only the upcoming make-up of this window blocks
    assert.deepEqual(bookedMakeupsLeftOut({ window, lessons, now }).map(l => l.id), ['m1']);
    // Shortening it to 09:00-10:00 leaves the 10:00 make-up out; to 10:00-12:00 keeps it inside
    assert.deepEqual(bookedMakeupsLeftOut({ window, after: { ...window, endTime: '10:00' }, lessons, now }).map(l => l.id), ['m1']);
    assert.deepEqual(bookedMakeupsLeftOut({ window, after: { ...window, startTime: '10:00', endTime: '12:00' }, lessons, now }), []);
    // Another day or another room: left out
    assert.equal(bookedMakeupsLeftOut({ window, after: { ...window, weekday: 5 }, lessons, now }).length, 1);
    assert.equal(bookedMakeupsLeftOut({ window, after: { ...window, roomId: 'salon1' }, lessons, now }).length, 1);
    // Once the class is moved or cancelled, it no longer blocks
    assert.deepEqual(bookedMakeupsLeftOut({ window, lessons: [{ ...booked, status: 'cancelada_por_profesor' }], now }), []);
});

test('plazo de pago: hasta el 5; en revisión no bloquea; rechazado después del 5 da 1 día más', () => {
    const june = { dueDate: '2027-06-05', status: 'por_pagar' };
    const day1 = paymentStanding({ payment: june, now: toUtc('2027-06-01', '09:00'), settings });
    assert.equal(day1.state, 'pendiente');
    assert.equal(day1.daysLeft, 4);
    assert.match(day1.message, /Tienes hasta el sábado 5 de junio para pagar \(quedan 4 días\)/);
    assert.equal(paymentStanding({ payment: june, now: toUtc('2027-06-05', '21:00'), settings }).message, 'Hoy es el último día para pagar.');

    const day6 = paymentStanding({ payment: june, now: toUtc('2027-06-06', '00:01'), settings });
    assert.equal(day6.state, 'vencido');
    assert.equal(day6.blocks, true);

    assert.equal(paymentStanding({ payment: { ...june, status: 'en_revision' }, now: toUtc('2027-06-06', '09:00'), settings }).blocks, false);

    const rejectedLate = { ...june, status: 'rechazado', reviewedAt: toUtc('2027-06-07', '10:00') };
    assert.equal(paymentStanding({ payment: rejectedLate, now: toUtc('2027-06-08', '20:00'), settings }).state, 'pendiente');
    assert.equal(paymentStanding({ payment: rejectedLate, now: toUtc('2027-06-09', '08:00'), settings }).blocks, true);

    // Rejected before the 5th: the usual deadline
    const rejectedEarly = { ...june, status: 'rechazado', reviewedAt: toUtc('2027-06-02', '10:00') };
    assert.equal(paymentStanding({ payment: rejectedEarly, now: toUtc('2027-06-06', '08:00'), settings }).blocks, true);
    assert.equal(paymentStanding({ payment: { ...june, status: 'aprobado' }, now: toUtc('2027-06-20', '08:00'), settings }).state, 'al_dia');
});

test('si no paga, las clases que alcanzó a tomar del 1 al 5 se cobran como sueltas', () => {
    const debt = unpaidClassesDebt({ takenLessons: [{ id: 'l1', startsAt: toUtc('2027-06-01', '16:00') }], prices });
    assert.deepEqual(debt.map(d => [d.type, d.lessonId, d.amount, d.period]), [['clase_suelta', 'l1', 65000, '2027-06']]);
});
