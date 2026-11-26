const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS } = require('../domain/settings');
const { toUtc, addHours, addMinutes, localParts } = require('../domain/time');
const {
    checkStudentReschedule, checkMakeupTarget, checkWindowSlot, listMakeupOptions,
    checkCancellation, checkAttendance, rescheduleDeadline,
} = require('../domain/lessons');
const { findDatedConflict, findWeeklyConflict } = require('../domain/conflicts');
const {
    generateCycleLessons, summarizeCycle, planCycleExpiry, nextCycleStartDate, computeEndDate, pendingMakeups,
} = require('../domain/cycles');
const { computeHoldExpiry, isHoldActive } = require('../domain/holds');

// These cases cover the 4-week cycles, written with the 24 hours they used
const settings = { ...DEFAULT_SETTINGS, horas_minimas_aviso: 24 };

// Cycle: lunes 2 al domingo 29 de noviembre de 2026
const cycle = { id: 'c1', studentId: 's1', startDate: '2026-11-02', endDate: '2026-11-29', status: 'activo', classesIncluded: 4 };

const lessonAt = (date, time, extra = {}) => {
    const startsAt = toUtc(date, time);
    return {
        id: `l-${date}-${time}`, cycleId: 'c1', studentId: 's1', teacherId: 't1', roomId: 'r2',
        startsAt, endsAt: addMinutes(startsAt, 60), status: 'programada', kind: 'regular', ...extra,
    };
};

const wednesday = lessonAt('2026-11-04', '15:00');

// --- Reprogramación: aviso mínimo y límite por ciclo ---

test('reprogramar a 23 horas de la clase falla', () => {
    const result = checkStudentReschedule({
        lesson: wednesday, cycle, cycleLessons: [wednesday], settings, now: addHours(wednesday.startsAt, -23),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'aviso_insuficiente');
});

test('reprogramar a 25 horas de la clase funciona', () => {
    const result = checkStudentReschedule({
        lesson: wednesday, cycle, cycleLessons: [wednesday], settings, now: addHours(wednesday.startsAt, -25),
    });
    assert.equal(result.ok, true);
    assert.equal(result.remaining, 1);
    assert.deepEqual(result.deadline, addHours(wednesday.startsAt, -24));
});

test('reprogramar justo a las 24 horas todavía se permite', () => {
    const result = checkStudentReschedule({
        lesson: wednesday, cycle, cycleLessons: [wednesday], settings, now: rescheduleDeadline(wednesday, settings),
    });
    assert.equal(result.ok, true);
});

test('el aviso mínimo sale de los ajustes', () => {
    const result = checkStudentReschedule({
        lesson: wednesday, cycle, cycleLessons: [wednesday],
        settings: { ...settings, horas_minimas_aviso: 12 },
        now: addHours(wednesday.startsAt, -13),
    });
    assert.equal(result.ok, true);
});

test('la segunda reprogramación del ciclo falla', () => {
    const alreadyMoved = lessonAt('2026-11-02', '15:00', { status: 'reprogramada_por_estudiante' });
    const result = checkStudentReschedule({
        lesson: wednesday, cycle, cycleLessons: [alreadyMoved, wednesday], settings, now: toUtc('2026-11-02', '08:00'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'limite_reprogramaciones');
});

test('una cancelación del profesor no consume el límite', () => {
    const cancelled = lessonAt('2026-11-02', '15:00', { status: 'cancelada_por_profesor' });
    const cycleLessons = [cancelled, wednesday];
    const result = checkStudentReschedule({ lesson: wednesday, cycle, cycleLessons, settings, now: toUtc('2026-11-02', '08:00') });
    assert.equal(result.ok, true);
    assert.equal(result.remaining, 1);

    const summary = summarizeCycle(cycle, cycleLessons, toUtc('2026-11-02', '08:00'));
    assert.equal(summary.reschedulesUsed, 0);
    assert.equal(summary.pendingMakeups, 1);
});

test('no se reprograma una clase de un ciclo sin pagar', () => {
    const result = checkStudentReschedule({
        lesson: wednesday, cycle: { ...cycle, status: 'pendiente_pago' }, cycleLessons: [wednesday], settings,
        now: toUtc('2026-11-01', '08:00'),
    });
    assert.equal(result.code, 'ciclo_inactivo');
});

// --- Vencimiento del ciclo ---

test('una reprogramación con fecha después del vencimiento falla', () => {
    const startsAt = toUtc('2026-11-30', '10:00');
    const result = checkMakeupTarget({
        startsAt, endsAt: addMinutes(startsAt, 60), mode: 'reprogramacion', cycle, settings, now: toUtc('2026-11-20', '10:00'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'despues_del_vencimiento');
});

test('el último día del ciclo todavía sirve para reprogramar', () => {
    const startsAt = toUtc('2026-11-28', '10:00');
    const result = checkMakeupTarget({
        startsAt, endsAt: addMinutes(startsAt, 60), mode: 'reprogramacion', cycle, settings, now: toUtc('2026-11-20', '10:00'),
    });
    assert.equal(result.ok, true);
});

test('la reposición de una clase cancelada por el profesor sí puede quedar después del vencimiento', () => {
    const startsAt = toUtc('2026-11-30', '10:00');
    const result = checkMakeupTarget({
        startsAt, endsAt: addMinutes(startsAt, 60), mode: 'reposicion', cycle, settings, now: toUtc('2026-11-20', '10:00'),
    });
    assert.equal(result.ok, true);
});

test('no se agenda en domingo, fuera del horario ni en un día de cierre', () => {
    const now = toUtc('2026-11-02', '10:00');
    const check = (date, time, closures = []) => {
        const startsAt = toUtc(date, time);
        return checkMakeupTarget({ startsAt, endsAt: addMinutes(startsAt, 60), mode: 'reposicion', cycle, settings, closures, now }).code;
    };
    assert.equal(check('2026-11-08', '10:00'), 'fuera_de_horario');
    assert.equal(check('2026-11-07', '06:00'), 'fuera_de_horario');
    assert.equal(check('2026-11-07', '20:30'), 'fuera_de_horario');
    assert.equal(check('2026-11-07', '10:00', [{ date: '2026-11-07' }]), 'dia_cierre');
    assert.equal(check('2026-11-02', '09:00'), 'horario_pasado');
});

// --- Choques ---

const ctxBase = { lessons: [], fixedSchedules: [], availabilities: [], holds: [], now: toUtc('2026-11-01', '08:00') };

test('un choque de salón entre dos profesores falla', () => {
    const otherTeacherLesson = lessonAt('2026-11-07', '09:00', { id: 'x', teacherId: 't2', studentId: 's9', roomId: 'r2' });
    const conflict = findDatedConflict(
        { startsAt: toUtc('2026-11-07', '09:30'), endsAt: toUtc('2026-11-07', '10:30'), roomId: 'r2', teacherId: 't1', studentId: 's1' },
        { ...ctxBase, lessons: [otherTeacherLesson], roomNames: { r2: 'Salón 2' } }
    );
    assert.equal(conflict.type, 'salon');
    assert.match(conflict.message, /Salón 2 ya está ocupado/);
});

test('las franjas de reposición de dos profesores no pueden cruzarse en el mismo salón', () => {
    const andres = { id: 'a1', teacherId: 't2', roomId: 'r2', weekday: 1, startTime: '14:00', endTime: '19:00', type: 'reposicion', active: true };
    const conflict = findWeeklyConflict(
        { kind: 'availability', weekday: 1, startTime: '15:00', endTime: '16:00', roomId: 'r2', teacherId: 't1' },
        { ...ctxBase, availabilities: [andres] }
    );
    assert.equal(conflict.type, 'salon');

    const otherRoom = findWeeklyConflict(
        { kind: 'availability', weekday: 1, startTime: '15:00', endTime: '16:00', roomId: 'r1', teacherId: 't1' },
        { ...ctxBase, availabilities: [andres] }
    );
    assert.equal(otherRoom, null);

    const back2back = findWeeklyConflict(
        { kind: 'availability', weekday: 1, startTime: '12:00', endTime: '14:00', roomId: 'r2', teacherId: 't1' },
        { ...ctxBase, availabilities: [andres] }
    );
    assert.equal(back2back, null);
});

test('una clase fija de otro profesor choca en el salón; las franjas de clase viejas ya no bloquean', () => {
    const andresClass = { id: 'f9', studentId: 's9', teacherId: 't2', roomId: 'r2', weekday: 1, startTime: '15:00', durationMinutes: 60, validFrom: '2026-10-01', validTo: null };
    const oldClassWindow = { id: 'a2', teacherId: 't2', roomId: 'r2', weekday: 1, startTime: '08:00', endTime: '12:00', type: 'clase', active: true };
    const ctx = { ...ctxBase, fixedSchedules: [andresClass], availabilities: [oldClassWindow] };

    const clash = findWeeklyConflict({ kind: 'fixed', weekday: 1, startTime: '15:30', endTime: '16:30', roomId: 'r2', teacherId: 't1', studentId: 's1', validFrom: '2026-11-01' }, ctx);
    assert.equal(clash.type, 'salon');
    const free = findWeeklyConflict({ kind: 'fixed', weekday: 1, startTime: '09:00', endTime: '10:00', roomId: 'r2', teacherId: 't1', studentId: 's1', validFrom: '2026-11-01' }, ctx);
    assert.equal(free, null);
});

test('la franja de otro profesor también bloquea una clase con fecha en ese salón', () => {
    const andres = { id: 'a1', teacherId: 't2', roomId: 'r2', weekday: 6, startTime: '11:00', endTime: '12:00', type: 'reposicion', active: true };
    const conflict = findDatedConflict(
        { startsAt: toUtc('2026-11-07', '11:00'), endsAt: toUtc('2026-11-07', '12:00'), roomId: 'r2', teacherId: 't1', studentId: 's1' },
        { ...ctxBase, availabilities: [andres] }
    );
    assert.equal(conflict.type, 'salon');
});

test('un profesor no puede estar en dos salones a la vez', () => {
    const elsewhere = lessonAt('2026-11-07', '09:00', { id: 'x', studentId: 's9', roomId: 'r1' });
    const conflict = findDatedConflict(
        { startsAt: toUtc('2026-11-07', '09:00'), endsAt: toUtc('2026-11-07', '10:00'), roomId: 'r2', teacherId: 't1', studentId: 's1' },
        { ...ctxBase, lessons: [elsewhere] }
    );
    assert.equal(conflict.type, 'profesor');
});

test('un estudiante no puede tener dos clases a la vez', () => {
    const otherClass = lessonAt('2026-11-07', '09:00', { id: 'x', teacherId: 't2', roomId: 'r3' });
    const conflict = findDatedConflict(
        { startsAt: toUtc('2026-11-07', '09:30'), endsAt: toUtc('2026-11-07', '10:30'), roomId: 'r2', teacherId: 't1', studentId: 's1' },
        { ...ctxBase, lessons: [otherClass] }
    );
    assert.equal(conflict.type, 'estudiante');
});

test('una clase cancelada libera su horario, también el del horario fijo', () => {
    const fixed = { id: 'f1', studentId: 's9', teacherId: 't2', roomId: 'r2', weekday: 6, startTime: '09:00', durationMinutes: 60, validFrom: '2026-10-01', validTo: null };
    const candidate = { startsAt: toUtc('2026-11-07', '09:00'), endsAt: toUtc('2026-11-07', '10:00'), roomId: 'r2', teacherId: 't1', studentId: 's1' };

    assert.equal(findDatedConflict(candidate, { ...ctxBase, fixedSchedules: [fixed] }).type, 'salon');

    const cancelled = lessonAt('2026-11-07', '09:00', { id: 'x', studentId: 's9', teacherId: 't2', status: 'cancelada_por_profesor' });
    assert.equal(findDatedConflict(candidate, { ...ctxBase, fixedSchedules: [fixed], lessons: [cancelled] }), null);
});

// --- Franjas de reposición y opciones ---

const saturdayWindow = { id: 'w1', teacherId: 't1', roomId: 'r2', weekday: 6, startTime: '09:00', endTime: '11:00', type: 'reposicion', capacity: 1, active: true };

test('una franja con cupo 1 no acepta una segunda reposición el mismo día', () => {
    const booked = lessonAt('2026-11-07', '09:00', { id: 'm1', studentId: 's9', availabilityId: 'w1', kind: 'reposicion' });
    const startsAt = toUtc('2026-11-07', '10:00');
    const result = checkWindowSlot({ window: saturdayWindow, startsAt, endsAt: addMinutes(startsAt, 60), lessons: [booked] });
    assert.equal(result.code, 'cupo_lleno');
});

test('las opciones solo incluyen franjas libres antes del vencimiento', () => {
    const now = toUtc('2026-11-16', '08:00');
    const options = listMakeupOptions({
        lesson: wednesday,
        windows: [saturdayWindow],
        fromDate: '2026-11-16',
        toDate: cycle.endDate,
        mode: 'reprogramacion',
        cycle, settings, closures: [{ date: '2026-11-21' }],
        ctx: { ...ctxBase, now },
    });
    // Sábados 21 (cierre) y 28: solo el 28, a las 9:00 y a las 10:00
    assert.deepEqual(options.map(o => localParts(o.startsAt).date + ' ' + localParts(o.startsAt).time), ['2026-11-28 09:00', '2026-11-28 10:00']);
});

// --- Generación, resumen y vencimiento de ciclos ---

const fixedWednesday = { id: 'f1', studentId: 's1', teacherId: 't1', roomId: 'r2', weekday: 3, startTime: '15:00', durationMinutes: 60, validFrom: '2026-10-01', validTo: null };

test('un ciclo de 4 semanas genera 4 clases desde el horario fijo', () => {
    const result = generateCycleLessons({ cycle, fixedSchedules: [fixedWednesday] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.lessons.map(l => localParts(l.startsAt).date), ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
    assert.ok(result.lessons.every(l => l.status === 'programada'));
});

test('una clase en día de cierre nace cancelada por la academia', () => {
    const result = generateCycleLessons({ cycle, fixedSchedules: [fixedWednesday], closures: [{ date: '2026-11-11', reason: 'Festivo' }] });
    assert.equal(result.lessons[1].status, 'cancelada_por_academia');
    assert.equal(pendingMakeups(result.lessons).length, 1);
});

test('sin horario fijo no se generan clases', () => {
    assert.equal(generateCycleLessons({ cycle, fixedSchedules: [] }).code, 'sin_horario_fijo');
});

test('fechas del ciclo: 4 semanas y arranque en la próxima clase', () => {
    assert.equal(computeEndDate('2026-11-02', settings), '2026-11-29');
    // Pago confirmado el miércoles 4 a las 16:00: la clase de las 15:00 ya pasó
    assert.equal(nextCycleStartDate([fixedWednesday], '2026-11-04', toUtc('2026-11-04', '16:00')), '2026-11-11');
});

test('el resumen sigue reprogramaciones y reposiciones hasta la clase vigente', () => {
    const l1 = lessonAt('2026-11-04', '15:00', { id: 'l1', status: 'tomada' });
    const l2 = lessonAt('2026-11-11', '15:00', { id: 'l2', status: 'reprogramada_por_estudiante' });
    const l2b = lessonAt('2026-11-14', '09:00', { id: 'l2b', kind: 'reposicion', originalLessonId: 'l2', status: 'tomada' });
    const l3 = lessonAt('2026-11-18', '15:00', { id: 'l3', status: 'cancelada_por_profesor' });
    const l4 = lessonAt('2026-11-25', '15:00', { id: 'l4' });
    const summary = summarizeCycle(cycle, [l1, l2, l2b, l3, l4], toUtc('2026-11-19', '08:00'));
    assert.deepEqual(summary.units.map(u => u.state), ['tomada', 'tomada', 'por_reponer', 'proxima']);
    assert.equal(summary.taken, 2);
    assert.equal(summary.reschedulesUsed, 1);
    assert.equal(summary.nextLesson.id, 'l4');
});

test('al vencer el ciclo, lo no marcado cuenta como tomada y la reposición que debe el profesor sigue pendiente', () => {
    const unmarked = lessonAt('2026-11-25', '15:00', { id: 'l4' });
    const owed = lessonAt('2026-11-18', '15:00', { id: 'l3', status: 'cancelada_por_profesor' });
    const bookedAfter = lessonAt('2026-12-05', '09:00', { id: 'm3', kind: 'reposicion', originalLessonId: 'l3' });

    assert.equal(planCycleExpiry(cycle, [unmarked], toUtc('2026-11-29', '20:00')).expire, false);

    const plan = planCycleExpiry(cycle, [unmarked, owed, bookedAfter], toUtc('2026-11-30', '00:00'));
    assert.equal(plan.expire, true);
    assert.deepEqual(plan.lessonUpdates, [{ id: 'l4', from: 'programada', to: 'tomada' }]);
});

test('una clase que ya terminó y nadie canceló cuenta como tomada en el resumen', () => {
    const given = lessonAt('2026-11-04', '15:00', { id: 'l1' });
    const ahead = lessonAt('2026-11-11', '15:00', { id: 'l2' });
    const during = summarizeCycle(cycle, [given, ahead], toUtc('2026-11-04', '15:30'));
    // In progress: not counted yet
    assert.deepEqual(during.units.map(u => u.state), ['programada', 'proxima']);
    assert.equal(during.taken, 0);
    const after = summarizeCycle(cycle, [given, ahead], toUtc('2026-11-04', '16:00'));
    assert.deepEqual(after.units.map(u => u.state), ['tomada', 'proxima']);
    assert.equal(after.taken, 1);
});

test('la reposición cuenta como una de las clases del paquete', () => {
    const cancelled = lessonAt('2026-11-04', '15:00', { id: 'l1', status: 'cancelada_por_profesor' });
    const makeup = lessonAt('2026-11-07', '09:00', { id: 'm1', kind: 'reposicion', originalLessonId: 'l1', status: 'tomada' });
    const summary = summarizeCycle(cycle, [cancelled, makeup], toUtc('2026-11-08', '08:00'));
    assert.equal(summary.units.length, 1);
    assert.equal(summary.units[0].state, 'tomada');
    assert.equal(summary.taken, 1);
});

// --- Cancelación y asistencia ---

test('el profesor cancela clases futuras; la academia deja otro estado', () => {
    const now = toUtc('2026-11-03', '08:00');
    assert.equal(checkCancellation(wednesday, { role: 'teacher' }, now).status, 'cancelada_por_profesor');
    assert.equal(checkCancellation(wednesday, { role: 'academy' }, now).status, 'cancelada_por_academia');
    assert.equal(checkCancellation(wednesday, { role: 'teacher' }, toUtc('2026-11-04', '15:30')).code, 'clase_pasada');
});

test('la asistencia se marca solo cuando la clase ya empezó', () => {
    assert.equal(checkAttendance(wednesday, 'tomada', toUtc('2026-11-04', '14:00')).code, 'clase_futura');
    assert.equal(checkAttendance(wednesday, 'perdida', toUtc('2026-11-04', '15:10')).ok, true);
    assert.equal(checkAttendance(wednesday, 'cancelada_por_profesor', toUtc('2026-11-04', '16:00')).code, 'estado_invalido');
});

// --- Cupos apartados ---

test('un cupo apartado expira a las 48 horas', () => {
    const heldAt = toUtc('2026-11-02', '10:00');
    const hold = {
        id: 'h1', teacherId: 't1', holdRoomId: 'r2', holdWeekday: 3, holdStartTime: '16:00', holdDurationMinutes: 60,
        holdStatus: 'apartado', holdExpiresAt: computeHoldExpiry(heldAt, settings),
    };
    assert.deepEqual(hold.holdExpiresAt, toUtc('2026-11-04', '10:00'));
    assert.equal(isHoldActive(hold, addMinutes(hold.holdExpiresAt, -1)), true);
    assert.equal(isHoldActive(hold, hold.holdExpiresAt), false);

    // While active it blocks that weekly slot; once expired it does not
    const candidate = { startsAt: toUtc('2026-11-11', '16:00'), endsAt: toUtc('2026-11-11', '17:00'), roomId: 'r2', teacherId: 't2', studentId: 's5' };
    assert.equal(findDatedConflict(candidate, { ...ctxBase, holds: [hold], now: addHours(heldAt, 47) }).source, 'cupo_apartado');
    assert.equal(findDatedConflict(candidate, { ...ctxBase, holds: [hold], now: addHours(heldAt, 48) }), null);
});
