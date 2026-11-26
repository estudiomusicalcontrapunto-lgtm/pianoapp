// Changing a student's teacher, archiving students and removing teachers.
const { Op } = require('sequelize');
const {
    sequelize, User, FixedSchedule, Lesson, Cycle, Availability, TeacherRoom,
    Notice, NoticeRecipient, AnnouncementRead, AuditLog, Assessment, Repertoire, LevelRequest, Payment,
    PaymentAdjustment, PaymentReceipt, PracticeDay, TermsAcceptance,
} = require('../models');
const { ROLES, LESSON_STATUS, CYCLE_STATUS } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { pendingMakeups } = require('../domain/cycles');
const { localDate, addDays, WEEKDAY_NAMES } = require('../domain/time');
const { PAYMENT_STATUS } = require('../domain/billing');
const { chargesToAnnul, deletionBlocker } = require('../domain/studentRemoval');
const { logAudit } = require('./audit');
const { createNotice } = require('./noticeService');

const plain = (row) => row.get({ plain: true });

// Fixed schedules stop today: the old teacher gets that time back
const endFixedSchedules = async (studentId, { now, transaction }) => {
    const today = localDate(now);
    const current = await FixedSchedule.findAll({
        where: { studentId, [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }] },
        transaction,
    });
    for (const fixed of current) {
        if (fixed.validFrom >= today) await fixed.destroy({ transaction });
        else await fixed.update({ validTo: addDays(today, -1) }, { transaction });
    }
    return current.length;
};

// Upcoming lessons become cancelada_por_academia (a make-up is owed)
const cancelUpcomingLessons = async (studentId, { reason, newTeacherId, actor, now, transaction }) => {
    const upcoming = await Lesson.findAll({
        where: { studentId, status: LESSON_STATUS.PROGRAMADA, startsAt: { [Op.gt]: now } },
        transaction,
    });
    for (const lesson of upcoming) {
        await lesson.update({
            status: LESSON_STATUS.CANCELADA_POR_ACADEMIA,
            reason,
            changedById: actor.id,
            changedAt: new Date(now),
            ...(newTeacherId && { teacherId: newTeacherId }),
        }, { transaction });
        await logAudit({
            entityType: 'lesson', entityId: lesson.id, action: 'cancelar',
            fromStatus: LESSON_STATUS.PROGRAMADA, toStatus: LESSON_STATUS.CANCELADA_POR_ACADEMIA, actorId: actor.id, details: { reason },
        }, { transaction });
    }
    return upcoming.length;
};

/**
 * Assigns another teacher. The old fixed schedule ends today; the lessons still
 * ahead in the cycle (and make-ups owed) move to the new teacher as "clases por
 * agendar", and the new teacher gives the student a new time.
 */
const changeTeacher = async ({ student, newTeacherId, actor, now = new Date() }) => {
    const previousTeacherId = student.teacherId;
    if (previousTeacherId === newTeacherId) return { moved: 0 };
    if (newTeacherId) {
        const teacher = await User.findByPk(newTeacherId);
        if (!teacher || teacher.role !== ROLES.TEACHER || !teacher.active) throw new DomainError('profesor_invalido', 'El profesor no existe.');
    }

    const moved = await sequelize.transaction(async (transaction) => {
        await endFixedSchedules(student.id, { now, transaction });
        const cancelled = await cancelUpcomingLessons(student.id, {
            reason: 'Cambio de profesor', newTeacherId, actor, now, transaction,
        });
        if (newTeacherId) {
            const lessons = (await Lesson.findAll({ where: { studentId: student.id }, transaction })).map(plain);
            const owed = pendingMakeups(lessons).filter(l => l.teacherId !== newTeacherId);
            if (owed.length) {
                await Lesson.update({ teacherId: newTeacherId }, { where: { id: owed.map(l => l.id) }, transaction });
            }
        }
        await student.update({ teacherId: newTeacherId || null }, { transaction });
        await logAudit({
            entityType: 'student', entityId: student.id, action: 'cambiar_profesor', actorId: actor.id,
            details: { from: previousTeacherId, to: newTeacherId, lessonsMoved: cancelled },
        }, { transaction });
        return cancelled;
    });

    const toAgenda = (await Lesson.findAll({ where: { studentId: student.id } })).map(plain);
    const pendingCount = newTeacherId ? pendingMakeups(toAgenda).filter(l => l.teacherId === newTeacherId).length : 0;
    if (newTeacherId) {
        await createNotice({
            category: 'estudiante_asignado',
            title: 'Nuevo estudiante',
            message: `La academia te asignó a ${student.name}.`
                + (pendingCount ? ` Tiene ${pendingCount} clase(s) por agendar de su ciclo actual.` : '')
                + ' Asígnale su horario en Mi agenda.',
            recipientIds: [newTeacherId],
            authorId: actor.id,
        });
    }
    if (previousTeacherId) {
        await createNotice({
            category: 'estudiante_reasignado',
            title: 'Estudiante reasignado',
            message: `${student.name} pasó a otro profesor. Su horario contigo quedó libre.`,
            recipientIds: [previousTeacherId],
            authorId: actor.id,
        });
    }
    await createNotice({
        category: 'cambio_profesor',
        title: 'Cambio de profesor',
        message: moved
            ? `Tienes un nuevo profesor. Tus ${moved} clase(s) pendiente(s) de este ciclo se volverán a agendar con tu nuevo horario.`
            : 'Tienes un nuevo profesor. Te avisaremos tu nuevo horario.',
        recipientIds: [student.id],
        authorId: actor.id,
    });
    return { moved };
};

// Classes the student still had: scheduled ahead, or cancelled and waiting for a make-up
const pendingClassesOf = async (studentId, { now, transaction }) => {
    const lessons = (await Lesson.findAll({ where: { studentId }, transaction })).map(plain);
    const upcoming = lessons.filter(l => l.status === LESSON_STATUS.PROGRAMADA && new Date(l.startsAt) > new Date(now));
    const owed = pendingMakeups(lessons);
    return { upcoming, owed };
};

const paymentsOf = async (studentId, { transaction } = {}) =>
    (await Payment.findAll({ where: { studentId }, transaction })).map(plain);

/** What archiving would lose, so the academy is warned first. */
const archivePreview = async ({ student, now = new Date() }) => {
    const { upcoming, owed } = await pendingClassesOf(student.id, { now });
    const activeCycles = await Cycle.count({ where: { studentId: student.id, status: CYCLE_STATUS.ACTIVO } });
    const charges = chargesToAnnul(await paymentsOf(student.id));
    return { upcoming: upcoming.length, owed: owed.length, activeCycles, chargesToAnnul: charges.length };
};

// "martes 08:00 y viernes 13:00"
const describeTimes = (schedules) => schedules
    .map(f => `${WEEKDAY_NAMES[f.weekday]} ${f.startTime}`)
    .join(', ')
    .replace(/, ([^,]*)$/, ' y $1');

/**
 * Archives a student (they may come back). Their pending classes are lost:
 * scheduled ones and owed make-ups become perdida, paid cycles are closed and
 * unpaid ones annulled, and so are the charges still waiting for payment (a debt
 * stays). The teacher is told their time is free. The account cannot log in;
 * the history is kept.
 */
const archiveStudent = async ({ student, actor, now = new Date() }) => {
    const today = localDate(now);
    const freedTimes = (await FixedSchedule.findAll({
        where: { studentId: student.id, [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }] },
        order: [['weekday', 'ASC'], ['startTime', 'ASC']],
    })).map(plain);

    const result = await sequelize.transaction(async (transaction) => {
        await endFixedSchedules(student.id, { now, transaction });
        const { upcoming, owed } = await pendingClassesOf(student.id, { now, transaction });
        for (const lesson of [...upcoming, ...owed]) {
            await Lesson.update(
                { status: LESSON_STATUS.PERDIDA, reason: 'Estudiante archivado', changedById: actor.id, changedAt: new Date(now) },
                { where: { id: lesson.id }, transaction }
            );
            await logAudit({
                entityType: 'lesson', entityId: lesson.id, action: 'archivar',
                fromStatus: lesson.status, toStatus: LESSON_STATUS.PERDIDA, actorId: actor.id,
            }, { transaction });
        }
        const open = await Cycle.findAll({
            where: { studentId: student.id, status: [CYCLE_STATUS.PENDIENTE_PAGO, CYCLE_STATUS.ACTIVO] },
            transaction,
        });
        for (const cycle of open) {
            await cycle.update({ status: cycle.status === CYCLE_STATUS.ACTIVO ? CYCLE_STATUS.FINALIZADO : CYCLE_STATUS.CANCELADO }, { transaction });
        }
        // Charges still waiting for payment are annulled; a debt stays for if they come back
        const annulled = chargesToAnnul(await paymentsOf(student.id, { transaction }));
        for (const payment of annulled) {
            await (await Payment.findByPk(payment.id, { transaction })).update({ status: PAYMENT_STATUS.ANULADO }, { transaction });
            await logAudit({
                entityType: 'payment', entityId: payment.id, action: 'archivar',
                fromStatus: payment.status, toStatus: PAYMENT_STATUS.ANULADO, actorId: actor.id,
            }, { transaction });
        }
        await student.update({ active: false }, { transaction });
        await logAudit({
            entityType: 'student', entityId: student.id, action: 'archivar', actorId: actor.id,
            details: { lostClasses: upcoming.length + owed.length, annulledCharges: annulled.length },
        }, { transaction });
        return { lostClasses: upcoming.length + owed.length, annulledCharges: annulled.length };
    });

    const teacherIds = [student.teacherId, ...freedTimes.map(f => f.teacherId)];
    for (const teacherId of new Set(teacherIds.filter(Boolean))) {
        const times = freedTimes.filter(f => f.teacherId === teacherId);
        await createNotice({
            category: 'estudiante_archivado',
            title: 'Estudiante retirado',
            message: `${student.name} ya no está en la academia.`
                + (times.length ? ` Su horario contigo (${describeTimes(times)}) quedó libre.` : ' Sus clases pendientes contigo se cancelaron.'),
            recipientIds: [teacherId],
            authorId: actor.id,
        });
    }
    return result;
};

/**
 * Deletes an archived student and everything that belongs to them (classes,
 * cycles, payments with their receipts and adjustments, schedules, repertoire,
 * practice days, notices, terms acceptances). Only archived students can be
 * deleted, so it is always a deliberate second step; see deletionBlocker for
 * when payments still hold them (a receipt under review, a paid month not over).
 * Returns the receipt paths so the caller can remove the files.
 */
const deleteArchivedStudent = async ({ student, actor, now = new Date() }) => {
    if (student.active) {
        throw new DomainError('estudiante_activo', 'Primero archiva al estudiante; solo se pueden eliminar estudiantes archivados.', 409);
    }
    const payments = await paymentsOf(student.id);
    const blocker = deletionBlocker(payments, localDate(now));
    if (blocker) throw new DomainError(blocker.code, blocker.message, 409);

    return sequelize.transaction(async (transaction) => {
        const cycles = await Cycle.findAll({ where: { studentId: student.id }, transaction });
        const paymentIds = payments.map(p => p.id);
        const paymentReceipts = await PaymentReceipt.findAll({ where: { paymentId: paymentIds }, transaction });
        const receipts = [...cycles.map(c => c.receiptPath), ...paymentReceipts.map(r => r.path)].filter(Boolean);

        // Links from other records to this user are cleared; their own records are deleted
        await Lesson.update({ changedById: null }, { where: { changedById: student.id }, transaction });
        await Notice.update({ authorId: null }, { where: { authorId: student.id }, transaction });
        await AuditLog.update({ actorId: null }, { where: { actorId: student.id }, transaction });
        await Assessment.update({ convertedStudentId: null }, { where: { convertedStudentId: student.id }, transaction });

        await NoticeRecipient.destroy({ where: { userId: student.id }, transaction });
        await AnnouncementRead.destroy({ where: { userId: student.id }, transaction });

        // Payments are never deleted on their own; deleting the whole student is the one
        // exception, so the immutability hooks are skipped here on purpose.
        await Lesson.update({ paymentId: null }, { where: { studentId: student.id }, transaction });
        await PaymentAdjustment.destroy({ where: { studentId: student.id }, hooks: false, transaction });
        await PaymentReceipt.destroy({ where: { paymentId: paymentIds }, hooks: false, transaction });
        await Payment.destroy({ where: { studentId: student.id }, hooks: false, transaction });

        await Lesson.update({ originalLessonId: null }, { where: { studentId: student.id }, transaction });
        await Lesson.destroy({ where: { studentId: student.id }, transaction });
        await Cycle.destroy({ where: { studentId: student.id }, transaction });
        await FixedSchedule.destroy({ where: { studentId: student.id }, transaction });
        await Repertoire.destroy({ where: { studentId: student.id }, transaction });
        await LevelRequest.destroy({ where: { studentId: student.id }, transaction });
        await PracticeDay.destroy({ where: { studentId: student.id }, transaction });
        await TermsAcceptance.destroy({ where: { userId: student.id }, transaction });
        await student.destroy({ transaction });

        await logAudit({
            entityType: 'student', entityId: student.id, action: 'eliminar', actorId: actor.id,
            details: {
                name: student.name,
                email: student.email,
                payments: payments.map(p => ({ type: p.type, period: p.period, amount: p.amount, status: p.status })),
            },
        }, { transaction });
        return { receipts };
    });
};

const restoreStudent = async ({ student, actor }) => {
    await student.update({ active: true });
    await logAudit({ entityType: 'student', entityId: student.id, action: 'restaurar', actorId: actor.id });
};

// The email of a removed teacher is freed so a new teacher can be created with it:
// "isa@contrapunto.com" -> "isa+eliminado-1a2b3c4d@contrapunto.com" (the original stays in the audit log)
const releasedEmail = (email, id) => {
    const at = email.lastIndexOf('@');
    return `${email.slice(0, at)}+eliminado-${String(id).slice(0, 8)}${email.slice(at)}`;
};

/**
 * Removes a teacher from the academy. Their students must be reassigned first.
 * The account is deactivated (not erased) so past lessons keep their teacher,
 * and its email is freed so it can be used again for a new teacher.
 */
const removeTeacher = async ({ teacher, actor }) => {
    const students = await User.findAll({ where: { role: ROLES.STUDENT, teacherId: teacher.id, active: true }, attributes: ['name'] });
    if (students.length) {
        throw new DomainError(
            'profesor_con_estudiantes',
            `Primero asígnale otro profesor a: ${students.map(s => s.name).join(', ')}.`,
            409
        );
    }
    await sequelize.transaction(async (transaction) => {
        await Availability.update({ active: false }, { where: { teacherId: teacher.id }, transaction });
        await TeacherRoom.destroy({ where: { teacherId: teacher.id }, transaction });
        const email = teacher.email;
        await teacher.update({ active: false, email: releasedEmail(email, teacher.id) }, { transaction });
        await logAudit({ entityType: 'teacher', entityId: teacher.id, action: 'eliminar', actorId: actor.id, details: { name: teacher.name, email } }, { transaction });
    });
};

module.exports = { changeTeacher, archivePreview, archiveStudent, deleteArchivedStudent, restoreStudent, removeTeacher, releasedEmail };
