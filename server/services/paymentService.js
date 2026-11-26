// Payments as records. A payment is created once with its type, period (or
// class), calculated amount and calculation; after that only its review
// status moves. Corrections are adjustments kept apart, and every step is in
// the audit log, so the history of each payment is complete.
const { sequelize, Payment, PaymentAdjustment, PaymentReceipt, AuditLog, User } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { PAYMENT_TYPE, PAYMENT_STATUS, paymentDeadline } = require('../domain/billing');
const { canManageStudentBookings } = require('../domain/permissions');
const { formatCOP } = require('../domain/money');
const { formatMonth, formatDay } = require('../domain/time');
const { getSettings } = require('./settingsService');
const { createNotice } = require('./noticeService');
const { logAudit } = require('./audit');

const plain = (row) => row.get({ plain: true });

/**
 * Registers a charge. data: { studentId, cityId, teacherId?, type, period?, lessonId?, amount, calculation, dueDate }
 */
const createPayment = async (data, { actor = null, transaction } = {}) => {
    if (!Object.values(PAYMENT_TYPE).includes(data.type)) throw new DomainError('tipo_invalido', 'El tipo de pago no es válido.');
    if (!Number.isInteger(data.amount) || data.amount < 0) throw new DomainError('monto_invalido', 'El monto debe ser un valor en pesos.');
    const payment = await Payment.create({ ...data, createdById: actor?.id || null }, { transaction });
    await logAudit({
        entityType: 'payment', entityId: payment.id, action: 'crear', toStatus: payment.status, actorId: actor?.id,
        details: { type: data.type, period: data.period || null, lessonId: data.lessonId || null, amount: data.amount },
    }, { transaction });
    return payment;
};

/**
 * A correction to a registered payment: the payment stays as it was and the
 * difference is a separate adjustment (negative = the student owes less).
 */
const recordCorrection = async ({ paymentId, amount, reason, actor }) => {
    if (!reason || !String(reason).trim()) throw new DomainError('motivo_requerido', 'Explica el motivo de la corrección.');
    if (!Number.isInteger(amount) || amount === 0) throw new DomainError('monto_invalido', 'El ajuste debe ser un valor en pesos distinto de 0.');
    return sequelize.transaction(async (transaction) => {
        const payment = await Payment.findByPk(paymentId, { transaction });
        if (!payment) throw new DomainError('pago_no_encontrado', 'Pago no encontrado.', 404);
        const adjustment = await PaymentAdjustment.create({
            studentId: payment.studentId,
            paymentId: payment.id,
            kind: 'correccion',
            amount,
            reason: String(reason).trim(),
            createdById: actor.id,
        }, { transaction });
        await logAudit({
            entityType: 'payment', entityId: payment.id, action: 'ajuste', actorId: actor.id,
            details: { adjustmentId: adjustment.id, amount, reason: adjustment.reason },
        }, { transaction });
        return plain(adjustment);
    });
};

/** What the student owes on a payment after its corrections. */
const netAmount = (payment, adjustments) =>
    payment.amount + adjustments.filter(a => a.paymentId === payment.id).reduce((sum, a) => sum + a.amount, 0);

/** The payment, its adjustments and every change, oldest first. */
const paymentHistory = async (paymentId) => {
    const payment = await Payment.findByPk(paymentId);
    if (!payment) throw new DomainError('pago_no_encontrado', 'Pago no encontrado.', 404);
    const [adjustments, changes] = await Promise.all([
        PaymentAdjustment.findAll({ where: { paymentId }, order: [['createdAt', 'ASC']] }),
        AuditLog.findAll({ where: { entityType: 'payment', entityId: paymentId }, order: [['createdAt', 'ASC']] }),
    ]);
    const plainAdjustments = adjustments.map(plain);
    return {
        payment: plain(payment),
        adjustments: plainAdjustments,
        changes: changes.map(plain),
        netAmount: netAmount(plain(payment), plainAdjustments),
    };
};

// --- Receipts and review ---

/** Only the academy reviews receipts: it collects every payment, in every city. */
const canReviewPayment = (actor) => actor?.role === ROLES.ACADEMY;

const loadPayment = async (paymentId, transaction) => {
    const payment = await Payment.findByPk(paymentId, { transaction });
    if (!payment) throw new DomainError('pago_no_encontrado', 'Pago no encontrado.', 404);
    return payment;
};

/** Checks the student (or the academy for them) can send a receipt for this payment now. */
const assertCanSendReceipt = async (paymentId, actor, { transaction } = {}) => {
    const payment = await loadPayment(paymentId, transaction);
    const student = await User.findByPk(payment.studentId, { transaction });
    if (!canManageStudentBookings(actor, student)) {
        throw new DomainError('sin_permiso', 'No puedes subir comprobantes de este estudiante.', 403);
    }
    if (payment.status === PAYMENT_STATUS.EN_REVISION) {
        throw new DomainError('pago_en_revision', 'Ya enviaste el comprobante de este pago y está en revisión. Te avisaremos cuando lo revisen.', 409);
    }
    if (payment.status === PAYMENT_STATUS.APROBADO) throw new DomainError('pago_aprobado', 'Este pago ya está aprobado.', 409);
    if (payment.status === PAYMENT_STATUS.ANULADO) {
        throw new DomainError('pago_anulado', 'Este cobro ya no está vigente. Comunícate con la academia.', 409);
    }
    return { payment, student };
};

/** Stores the receipt (one per payment; a rejected one stays in the history) and sends the payment to review. */
const submitPaymentReceipt = async ({ paymentId, actor, file, now = new Date() }) =>
    sequelize.transaction(async (transaction) => {
        const { payment, student } = await assertCanSendReceipt(paymentId, actor, { transaction });
        const receipt = await PaymentReceipt.create({
            paymentId: payment.id, path: file.path, originalName: file.originalName || null, mimeType: file.mimeType || null, uploadedById: actor.id,
        }, { transaction });
        const from = payment.status;
        await payment.update({ status: PAYMENT_STATUS.EN_REVISION, rejectionReason: null, updatedAt: new Date(now) }, { transaction });
        await logAudit({
            entityType: 'payment', entityId: payment.id, action: 'subir_comprobante', fromStatus: from, toStatus: PAYMENT_STATUS.EN_REVISION,
            actorId: actor.id, details: { receiptId: receipt.id },
        }, { transaction });

        const academy = (await User.findAll({ where: { role: ROLES.ACADEMY, active: true }, attributes: ['id'], transaction })).map(u => u.id);
        await createNotice({
            category: 'comprobante_recibido',
            title: 'Comprobante recibido',
            message: `${student.name} subió el comprobante de ${describePayment(payment)} (${formatCOP(payment.amount)}). Revísalo en Pagos.`,
            recipientIds: academy,
            authorId: actor.id,
            meta: { paymentId: payment.id },
        }, { transaction });
        return { payment: plain(payment), receipt: plain(receipt) };
    });

const currentReceipt = (paymentId, transaction) =>
    PaymentReceipt.findOne({ where: { paymentId, status: 'en_revision' }, order: [['createdAt', 'DESC']], transaction });

const assertReviewable = async (paymentId, actor, transaction) => {
    const payment = await loadPayment(paymentId, transaction);
    if (!canReviewPayment(actor)) {
        throw new DomainError('sin_permiso', 'No puedes revisar este pago.', 403);
    }
    if (payment.status !== PAYMENT_STATUS.EN_REVISION) {
        throw new DomainError('pago_no_en_revision', 'Este pago no tiene un comprobante esperando revisión.', 409);
    }
    return payment;
};

const approvePayment = async ({ paymentId, actor, now = new Date() }) =>
    sequelize.transaction(async (transaction) => {
        const payment = await assertReviewable(paymentId, actor, transaction);
        const receipt = await currentReceipt(payment.id, transaction);
        if (receipt) await receipt.update({ status: 'aprobado', reviewedById: actor.id, reviewedAt: new Date(now) }, { transaction });
        await payment.update({ status: PAYMENT_STATUS.APROBADO, reviewedById: actor.id, reviewedAt: new Date(now) }, { transaction });
        await logAudit({
            entityType: 'payment', entityId: payment.id, action: 'aprobar', fromStatus: PAYMENT_STATUS.EN_REVISION, toStatus: PAYMENT_STATUS.APROBADO, actorId: actor.id,
        }, { transaction });
        await createNotice({
            category: 'pago_confirmado',
            title: 'Pago aprobado',
            message: `Aprobamos tu pago de ${describePayment(payment)} (${formatCOP(payment.amount)}). ¡Gracias!`,
            recipientIds: [payment.studentId],
            authorId: actor.id,
            meta: { paymentId: payment.id },
        }, { transaction });
        // Only now the month's classes go to the agenda (and single classes can be booked).
        // Required here: billingService requires this module.
        const { afterPaymentApproved } = require('./billingService');
        await afterPaymentApproved({ payment: plain(payment), actor, now, transaction });
        return plain(payment);
    });

const rejectPayment = async ({ paymentId, actor, reason, now = new Date() }) => {
    if (!reason || !String(reason).trim()) throw new DomainError('motivo_requerido', 'Escribe el motivo del rechazo para que el estudiante sepa qué corregir.');
    return sequelize.transaction(async (transaction) => {
        const payment = await assertReviewable(paymentId, actor, transaction);
        const text = String(reason).trim();
        const receipt = await currentReceipt(payment.id, transaction);
        if (receipt) await receipt.update({ status: 'rechazado', rejectionReason: text, reviewedById: actor.id, reviewedAt: new Date(now) }, { transaction });
        await payment.update({ status: PAYMENT_STATUS.RECHAZADO, rejectionReason: text, reviewedById: actor.id, reviewedAt: new Date(now) }, { transaction });
        await logAudit({
            entityType: 'payment', entityId: payment.id, action: 'rechazar', fromStatus: PAYMENT_STATUS.EN_REVISION, toStatus: PAYMENT_STATUS.RECHAZADO,
            actorId: actor.id, details: { reason: text },
        }, { transaction });
        const deadline = paymentDeadline(plain(payment), await getSettings({ transaction }));
        await createNotice({
            category: 'pago_rechazado',
            title: 'Comprobante rechazado',
            message: `No pudimos aprobar tu comprobante de ${describePayment(payment)}: ${text}. Sube otro a más tardar el ${formatDay(deadline)}.`,
            recipientIds: [payment.studentId],
            authorId: actor.id,
            meta: { paymentId: payment.id },
        }, { transaction });
        return plain(payment);
    });
};

// "la mensualidad de junio de 2027", "la clase suelta del martes 15 de junio"
const describePayment = (payment) => {
    if (payment.type === PAYMENT_TYPE.MENSUALIDAD) return `la mensualidad de ${formatMonth(payment.period)}`;
    if (payment.type === PAYMENT_TYPE.PROPORCIONAL) return `tus clases de ${formatMonth(payment.period)}`;
    return 'la clase suelta';
};

module.exports = {
    createPayment, recordCorrection, paymentHistory, netAmount,
    canReviewPayment, assertCanSendReceipt, submitPaymentReceipt, approvePayment, rejectPayment, describePayment,
};
