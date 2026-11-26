// Free assessments ("valoraciones"): the slot can be held for horas_cupo_apartado
// hours, and the prospect becomes a student only when the payment is confirmed.
const { Assessment, Cycle, User } = require('../models');
const { ASSESSMENT_STATUS, HOLD_STATUS, CYCLE_PLAN } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { computeHoldExpiry } = require('../domain/holds');
const { localDate } = require('../domain/time');
const { runBookingTransaction } = require('./bookingTransaction');
const { validateWeeklyBooking, createFixedSchedule } = require('./fixedScheduleService');
const { createStudent } = require('./accountService');
const { createCycle, activateCycle } = require('./cycleService');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./audit');

const plain = (row) => row.get({ plain: true });

const loadAssessment = async (id, transaction) => {
    const assessment = await Assessment.findByPk(id, { transaction });
    if (!assessment) throw new DomainError('valoracion_no_encontrada', 'Valoración no encontrada.', 404);
    return assessment;
};

const createAssessment = async ({ data, actor }) => {
    if (!data.studentName || !data.studentName.trim()) throw new DomainError('nombre_requerido', 'El nombre del aspirante es obligatorio.');
    if (!data.scheduledAt || Number.isNaN(Date.parse(data.scheduledAt))) throw new DomainError('fecha_invalida', 'Indica la fecha y hora de la valoración.');
    const teacher = await User.findByPk(data.teacherId);
    if (!teacher || teacher.role !== 'teacher') throw new DomainError('profesor_invalido', 'Elige el profesor de la valoración.');

    const assessment = await Assessment.create({
        studentName: data.studentName.trim(),
        studentBirthDate: data.studentBirthDate || null,
        contactName: data.contactName || null,
        contactPhone: data.contactPhone || null,
        contactEmail: data.contactEmail || null,
        scheduledAt: new Date(data.scheduledAt),
        teacherId: teacher.id,
    });
    await logAudit({ entityType: 'assessment', entityId: assessment.id, action: 'crear', toStatus: assessment.status, actorId: actor.id });
    return assessment;
};

const UPDATABLE = ['studentName', 'studentBirthDate', 'contactName', 'contactPhone', 'contactEmail', 'result', 'status'];

const updateAssessment = async ({ id, data, actor }) => {
    const assessment = await loadAssessment(id);
    if (data.status && ![ASSESSMENT_STATUS.AGENDADA, ASSESSMENT_STATUS.REALIZADA, ASSESSMENT_STATUS.DESCARTADA].includes(data.status)) {
        throw new DomainError('estado_invalido', 'Estado de valoración no válido.');
    }
    const changes = Object.fromEntries(UPDATABLE.filter(f => data[f] !== undefined).map(f => [f, data[f] === '' ? null : data[f]]));
    const from = assessment.status;
    // Discarding also frees the held slot
    if (changes.status === ASSESSMENT_STATUS.DESCARTADA && assessment.holdStatus === HOLD_STATUS.APARTADO) {
        changes.holdStatus = HOLD_STATUS.LIBERADO;
    }
    await assessment.update(changes);
    if (changes.status && changes.status !== from) {
        await logAudit({ entityType: 'assessment', entityId: id, action: 'cambiar_estado', fromStatus: from, toStatus: changes.status, actorId: actor.id });
    }
    return assessment;
};

/** Holds a weekly slot of the assessment's teacher until the hold expires. */
const holdSlot = async ({ id, roomId, weekday, startTime, durationMinutes, actor, now = new Date() }) => {
    const draft = await loadAssessment(id);
    return runBookingTransaction({ roomIds: [roomId], userIds: [draft.teacherId] }, async (transaction) => {
        const assessment = await loadAssessment(id, transaction);
        if ([ASSESSMENT_STATUS.CONVERTIDA, ASSESSMENT_STATUS.DESCARTADA].includes(assessment.status)) {
            throw new DomainError('valoracion_cerrada', 'Esta valoración ya está cerrada.');
        }
        const settings = await getSettings({ transaction });
        const duration = durationMinutes || settings.duracion_clase_minutos;
        await validateWeeklyBooking({
            kind: 'hold', teacherId: assessment.teacherId, roomId, weekday: Number(weekday), startTime,
            durationMinutes: duration, validFrom: localDate(now), ignore: { holdId: assessment.id },
        }, { transaction, now });

        const holdExpiresAt = computeHoldExpiry(now, settings);
        await assessment.update({
            holdRoomId: roomId,
            holdWeekday: Number(weekday),
            holdStartTime: startTime,
            holdDurationMinutes: duration,
            holdExpiresAt,
            holdStatus: HOLD_STATUS.APARTADO,
            status: assessment.status === ASSESSMENT_STATUS.AGENDADA ? ASSESSMENT_STATUS.REALIZADA : assessment.status,
        }, { transaction });
        await logAudit({
            entityType: 'assessment', entityId: id, action: 'apartar_cupo', toStatus: HOLD_STATUS.APARTADO, actorId: actor.id,
            details: { roomId, weekday, startTime, holdExpiresAt },
        }, { transaction });
        return plain(assessment);
    });
};

const releaseHold = async ({ id, actor }) => {
    const assessment = await loadAssessment(id);
    if (assessment.holdStatus !== HOLD_STATUS.APARTADO) throw new DomainError('sin_cupo', 'Esta valoración no tiene un cupo apartado.');
    await assessment.update({ holdStatus: HOLD_STATUS.LIBERADO });
    await logAudit({ entityType: 'assessment', entityId: id, action: 'liberar_cupo', fromStatus: HOLD_STATUS.APARTADO, toStatus: HOLD_STATUS.LIBERADO, actorId: actor.id });
    return assessment;
};

/**
 * Payment received: creates the student account, their fixed schedule from the
 * held slot and a paid cycle with its lessons, all or nothing.
 * If the hold already expired, the slot is used only if it is still free.
 * Returns { student, tempPassword, cycle, lessons }.
 */
const convertAssessment = async ({ id, email, plan = CYCLE_PLAN.PAQUETE_4, startDate, actor, now = new Date() }) => {
    const draft = await loadAssessment(id);
    if (!draft.holdRoomId) throw new DomainError('sin_cupo', 'Primero aparta un horario para esta valoración.');

    return runBookingTransaction({ roomIds: [draft.holdRoomId], userIds: [draft.teacherId] }, async (transaction) => {
        const assessment = await loadAssessment(id, transaction);
        if (assessment.status === ASSESSMENT_STATUS.CONVERTIDA) {
            throw new DomainError('ya_convertida', 'Esta valoración ya se convirtió en estudiante.', 409);
        }
        if (![HOLD_STATUS.APARTADO, HOLD_STATUS.LIBERADO].includes(assessment.holdStatus)) {
            throw new DomainError('sin_cupo', 'Primero aparta un horario para esta valoración.');
        }

        const { student, tempPassword } = await createStudent({
            name: assessment.studentName,
            email: email || assessment.contactEmail,
            teacherId: assessment.teacherId,
            birthDate: assessment.studentBirthDate,
            guardianName: assessment.contactName,
            guardianPhone: assessment.contactPhone,
        }, { transaction });

        // The hold itself never blocks its own conversion; if it already expired,
        // the slot is checked against everything else and must still be free
        await createFixedSchedule({
            studentId: student.id,
            teacherId: assessment.teacherId,
            roomId: assessment.holdRoomId,
            weekday: assessment.holdWeekday,
            startTime: assessment.holdStartTime,
            durationMinutes: assessment.holdDurationMinutes,
            validFrom: localDate(now),
        }, { actor, transaction, now, ignoreHoldId: assessment.id });

        const cycle = await createCycle({ studentId: student.id, plan, startDate, actor, now, transaction });
        const activation = await activateCycle(await Cycle.findByPk(cycle.id, { transaction }), { actor, now, transaction });

        const holdFrom = assessment.holdStatus;
        await assessment.update({
            status: ASSESSMENT_STATUS.CONVERTIDA,
            holdStatus: HOLD_STATUS.CONVERTIDO,
            convertedStudentId: student.id,
        }, { transaction });
        await logAudit({
            entityType: 'assessment', entityId: id, action: 'convertir', fromStatus: holdFrom, toStatus: HOLD_STATUS.CONVERTIDO,
            actorId: actor.id, details: { studentId: student.id, cycleId: cycle.id },
        }, { transaction });

        return { student: student.toJSON(), tempPassword, cycle: activation.cycle, lessons: activation.lessons };
    });
};

module.exports = { createAssessment, updateAssessment, holdSlot, releaseHold, convertAssessment };
