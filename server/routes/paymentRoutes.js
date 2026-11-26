// Payments of the monthly billing: the student's charges and receipts, and the
// academy's review. A registered payment is never edited or deleted.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { Op } = require('sequelize');
const { Payment, PaymentReceipt, PaymentAdjustment, User, City, Lesson } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { canViewStudent } = require('../domain/permissions');
const { DomainError } = require('../domain/errors');
const { paymentStanding, singleClassCharge } = require('../domain/billing');
const { PaymentLockedError } = require('../domain/paymentRecords');
const { localDate } = require('../domain/time');
const { UPLOADS_DIR } = require('./cycleRoutes');
const { getSettings } = require('../services/settingsService');
const {
    pricesForStudent, paymentTextFor, bookSingleClasses, chargeMonthByHand, scheduleSingleClass, pendingSingleClasses,
} = require('../services/billingService');
const {
    createPayment, recordCorrection, paymentHistory, netAmount, canReviewPayment, assertCanSendReceipt,
    submitPaymentReceipt, approvePayment, rejectPayment, describePayment,
} = require('../services/paymentService');

const plain = (row) => row.get({ plain: true });

// Payments with their receipts, corrections and where they stand today
const paymentsJSON = async (payments, now = new Date()) => {
    const ids = payments.map(p => p.id);
    const [receipts, adjustments, settings] = await Promise.all([
        PaymentReceipt.findAll({ where: { paymentId: ids }, order: [['createdAt', 'ASC']] }),
        PaymentAdjustment.findAll({ where: { [Op.or]: [{ paymentId: ids }, { appliedPaymentId: ids }] } }),
        getSettings(),
    ]);
    const plainAdjustments = adjustments.map(plain);
    return payments.map(row => {
        const { student, teacher, city, ...payment } = plain(row);
        return {
            ...payment,
            description: describePayment(payment),
            studentName: student?.name,
            teacherName: teacher?.name,
            cityName: city?.name,
            standing: paymentStanding({ payment, now, settings }),
            netAmount: netAmount(payment, plainAdjustments),
            adjustments: plainAdjustments.filter(a => a.paymentId === payment.id),
            discounts: plainAdjustments.filter(a => a.appliedPaymentId === payment.id),
            receipts: receipts.filter(r => r.paymentId === payment.id).map(r => ({
                id: r.id, status: r.status, rejectionReason: r.rejectionReason, uploadedAt: r.createdAt, mimeType: r.mimeType,
            })),
        };
    });
};

const include = [
    { model: User, as: 'student', attributes: ['id', 'name'] },
    { model: User, as: 'teacher', attributes: ['id', 'name'] },
    { model: City, as: 'city', attributes: ['id', 'name'] },
];

// The student's own payments, the payment text and their prices
router.get('/me', auth, requireRole('student'), async (req, res) => {
    try {
        const payments = await Payment.findAll({ where: { studentId: req.currentUser.id }, include, order: [['createdAt', 'DESC']] });
        const [items, paymentText] = await Promise.all([
            paymentsJSON(payments),
            paymentTextFor(req.currentUser).catch(() => ({ text: '' })),
        ]);
        res.json({ payments: items, paymentText: paymentText.text });
    } catch (error) {
        handleError(res, error);
    }
});

// Academy: every payment (filters status, period, studentId, cityId). Only the academy collects and reviews.
router.get('/', auth, requireRole('academy'), async (req, res) => {
    try {
        const where = {};
        for (const field of ['status', 'period', 'studentId', 'cityId', 'type']) {
            if (req.query[field]) where[field] = String(req.query[field]).split(',');
        }
        const payments = await Payment.findAll({ where, include, order: [['updatedAt', 'DESC']], limit: 300 });
        res.json(await paymentsJSON(payments));
    } catch (error) {
        handleError(res, error);
    }
});

// A clase suelta charged apart (e.g. an extra class): { studentId, date, lessonId? }
router.post('/single-class', auth, requireRole('academy'), async (req, res) => {
    try {
        const student = await User.findOne({ where: { id: req.body.studentId, role: 'student' } });
        if (!student) throw new DomainError('estudiante_invalido', 'El estudiante no existe.', 404);
        const lesson = req.body.lessonId ? await Lesson.findOne({ where: { id: req.body.lessonId, studentId: student.id } }) : null;
        const date = lesson ? localDate(lesson.startsAt) : req.body.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new DomainError('fecha_invalida', 'Indica la fecha de la clase (AAAA-MM-DD).');
        const { city, prices } = await pricesForStudent(student);
        const { lessonDate, ...charge } = singleClassCharge({ lessonDate: date, prices, dueDate: date < localDate(new Date()) ? localDate(new Date()) : date });
        const payment = await createPayment({
            studentId: student.id, cityId: city.id, teacherId: student.teacherId, lessonId: lesson?.id || null, ...charge,
            calculation: { ...charge.calculation, lessonDate },
        }, { actor: req.currentUser });
        const full = await Payment.findByPk(payment.id, { include });
        res.status(201).json((await paymentsJSON([full]))[0]);
    } catch (error) {
        handleError(res, error);
    }
});

// The academy gives single classes of one month, all in one charge; the teacher books them:
// { studentId, period: 'YYYY-MM', count, classes?: [{ date, startTime, roomId }] (dates already agreed) }
router.post('/single-classes', auth, requireRole('academy'), async (req, res) => {
    try {
        const { payment, lessons, left } = await bookSingleClasses({
            studentId: req.body.studentId, period: req.body.period, count: req.body.count, classes: req.body.classes || [], actor: req.currentUser,
        });
        const full = await Payment.findByPk(payment.id, { include });
        res.status(201).json({ payment: (await paymentsJSON([full]))[0], lessons, left });
    } catch (error) {
        handleError(res, error);
    }
});

// Single classes still to book (teacher: their students; academy: all)
router.get('/single-classes/pending', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        res.json(await pendingSingleClasses({ actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// The teacher books one of them: { roomId, startsAt }
router.post('/:id/classes', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        res.status(201).json(await scheduleSingleClass({ paymentId: req.params.id, actor: req.currentUser, roomId: req.body.roomId, startsAt: req.body.startsAt }));
    } catch (error) {
        handleError(res, error);
    }
});

// The academy charges a mensualidad by hand: { studentId, period? ('YYYY-MM', this month or next) }
router.post('/monthly', auth, requireRole('academy'), async (req, res) => {
    try {
        const { payment } = await chargeMonthByHand({ studentId: req.body.studentId, period: req.body.period || null, actor: req.currentUser });
        const full = await Payment.findByPk(payment.id, { include });
        res.status(201).json((await paymentsJSON([full]))[0]);
    } catch (error) {
        handleError(res, error);
    }
});

// Registered payments are never edited or deleted: corrections are adjustments
router.put('/:id', auth, requireRole(), (req, res) => handleError(res, new PaymentLockedError()));
router.patch('/:id', auth, requireRole(), (req, res) => handleError(res, new PaymentLockedError()));
router.delete('/:id', auth, requireRole(), (req, res) => handleError(res, new PaymentLockedError()));

// { amount (negative = owes less), reason }
router.post('/:id/adjustments', auth, requireRole('academy'), async (req, res) => {
    try {
        res.status(201).json(await recordCorrection({ paymentId: req.params.id, amount: Number(req.body.amount), reason: req.body.reason, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// The payment, its adjustments and every change
router.get('/:id/history', auth, requireRole(), async (req, res) => {
    try {
        const payment = await Payment.findByPk(req.params.id, { include: [{ model: User, as: 'student' }] });
        if (!payment) throw new DomainError('pago_no_encontrado', 'Pago no encontrado.', 404);
        if (!canViewStudent(req.currentUser, payment.student)) throw new DomainError('sin_permiso', 'No tienes acceso a este pago.', 403);
        res.json(await paymentHistory(payment.id));
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/approve', auth, requireRole('academy'), async (req, res) => {
    try {
        await approvePayment({ paymentId: req.params.id, actor: req.currentUser });
        res.json((await paymentsJSON([await Payment.findByPk(req.params.id, { include })]))[0]);
    } catch (error) {
        handleError(res, error);
    }
});

// { reason }
router.post('/:id/reject', auth, requireRole('academy'), async (req, res) => {
    try {
        await rejectPayment({ paymentId: req.params.id, actor: req.currentUser, reason: req.body.reason });
        res.json((await paymentsJSON([await Payment.findByPk(req.params.id, { include })]))[0]);
    } catch (error) {
        handleError(res, error);
    }
});

// Receipt: a photo (JPG, PNG, WEBP, HEIC) or a PDF up to 10 MB, outside any public folder
const RECEIPTS_DIR = path.join(UPLOADS_DIR, 'payment-receipts');
const RECEIPT_TYPES = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'application/pdf': '.pdf',
};
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
            cb(null, RECEIPTS_DIR);
        },
        filename: (req, file, cb) => cb(null, `${req.params.id}-${Date.now()}${RECEIPT_TYPES[file.mimetype]}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, !!RECEIPT_TYPES[file.mimetype]),
});

// Permission and state are checked before the file is written
const checkReceiptUpload = async (req, res, next) => {
    try {
        await assertCanSendReceipt(req.params.id, req.currentUser);
        next();
    } catch (error) {
        handleError(res, error);
    }
};

const receiveFile = (req, res, next) => upload.single('receipt')(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'La foto o el archivo pesa más de 10 MB. Intenta con otra foto.' });
    if (error) return handleError(res, error);
    if (!req.file) return res.status(400).json({ message: 'Adjunta una foto del comprobante o un PDF.' });
    next();
});

router.post('/:id/receipt', auth, requireRole('academy', 'student'), checkReceiptUpload, receiveFile, async (req, res) => {
    try {
        await submitPaymentReceipt({
            paymentId: req.params.id,
            actor: req.currentUser,
            file: {
                path: path.relative(UPLOADS_DIR, req.file.path).split(path.sep).join('/'),
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
            },
        });
        res.json((await paymentsJSON([await Payment.findByPk(req.params.id, { include })]))[0]);
    } catch (error) {
        fs.rm(req.file.path, { force: true }, () => {});
        handleError(res, error);
    }
});

// A receipt file: the student, their teacher and the academy can open it
router.get('/:id/receipts/:receiptId', auth, requireRole(), async (req, res) => {
    try {
        const payment = await Payment.findByPk(req.params.id, { include: [{ model: User, as: 'student' }] });
        if (!payment) throw new DomainError('pago_no_encontrado', 'Pago no encontrado.', 404);
        if (!canViewStudent(req.currentUser, payment.student) && !canReviewPayment(req.currentUser)) {
            throw new DomainError('sin_permiso', 'No tienes acceso a este comprobante.', 403);
        }
        const receipt = await PaymentReceipt.findOne({ where: { id: req.params.receiptId, paymentId: payment.id } });
        if (!receipt) throw new DomainError('comprobante_no_encontrado', 'Comprobante no encontrado.', 404);
        const file = path.resolve(UPLOADS_DIR, receipt.path);
        if (!file.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(file)) {
            throw new DomainError('archivo_no_encontrado', 'No se encontró el archivo del comprobante.', 404);
        }
        res.sendFile(file);
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
