const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { Op } = require('sequelize');
const { Cycle, Lesson, User } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { summarizeCycle } = require('../domain/cycles');
const { canViewStudent } = require('../domain/permissions');
const multer = require('multer');
const {
    suggestStartDate, createCycle, confirmCyclePayment, rejectPayment, cancelCycle, assertCanSubmitReceipt, submitReceipt,
} = require('../services/cycleService');
const { createNotice, notifyPaymentConfirmed } = require('../services/noticeService');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
const isAcademy = requireRole('academy');

// Cycles with student name and the "Mi mensualidad" summary
const withSummaries = async (cycles, now = new Date()) => {
    const lessons = await Lesson.findAll({ where: { cycleId: cycles.map(c => c.id) } });
    return cycles.map(cycle => {
        const own = lessons.filter(l => l.cycleId === cycle.id).map(l => l.get({ plain: true }));
        const { units, nextLesson, ...summary } = summarizeCycle(cycle, own, now);
        return {
            ...cycle.get({ plain: true }),
            studentName: cycle.student?.name || null,
            hasReceipt: !!cycle.receiptPath,
            summary: { ...summary, units: units.map(u => ({ state: u.state, lessonId: u.lesson.id, startsAt: u.lesson.startsAt })) },
        };
    });
};

// Academy: all (filters: paymentStatus, status, studentId). Teacher: their students. Student: their own.
router.get('/', auth, requireRole(), async (req, res) => {
    try {
        const actor = req.currentUser;
        const where = {};
        for (const field of ['paymentStatus', 'status', 'studentId']) {
            if (req.query[field]) where[field] = String(req.query[field]).split(',');
        }
        if (actor.role === 'student') {
            where.studentId = actor.id;
        } else if (actor.role === 'teacher') {
            const students = await User.findAll({ where: { role: 'student', teacherId: actor.id }, attributes: ['id'] });
            const own = students.map(s => s.id);
            where.studentId = where.studentId ? where.studentId.filter(id => own.includes(id)) : own;
        }
        const cycles = await Cycle.findAll({
            where,
            include: [{ model: User, as: 'student', attributes: ['id', 'name'] }],
            order: [['startDate', 'DESC']],
        });
        res.json(await withSummaries(cycles));
    } catch (error) {
        handleError(res, error);
    }
});

router.get('/suggest-start', auth, isAcademy, async (req, res) => {
    try {
        res.json({ startDate: await suggestStartDate(req.query.studentId) });
    } catch (error) {
        handleError(res, error);
    }
});

// { studentId, plan: 'paquete_4' | 'suelta', startDate? }
router.post('/', auth, isAcademy, async (req, res) => {
    try {
        const cycle = await createCycle({ ...req.body, actor: req.currentUser });
        const full = await Cycle.findByPk(cycle.id, { include: [{ model: User, as: 'student', attributes: ['id', 'name'] }] });
        res.status(201).json((await withSummaries([full]))[0]);
    } catch (error) {
        handleError(res, error);
    }
});

const respondWithCycle = async (res, id) => {
    const cycle = await Cycle.findByPk(id, { include: [{ model: User, as: 'student', attributes: ['id', 'name'] }] });
    res.json((await withSummaries([cycle]))[0]);
};

// Confirms the payment: activates the cycle and generates its lessons. { keepDates? }
router.post('/:id/confirm', auth, isAcademy, async (req, res) => {
    try {
        const { cycle, lessons, unscheduled } = await confirmCyclePayment({ cycleId: req.params.id, actor: req.currentUser, keepDates: !!req.body.keepDates });
        await notifyPaymentConfirmed({ cycle, lessons, unscheduled, actor: req.currentUser });
        await respondWithCycle(res, req.params.id);
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/reject', auth, isAcademy, async (req, res) => {
    try {
        const cycle = await rejectPayment({ cycleId: req.params.id, actor: req.currentUser, reason: req.body.reason });
        await createNotice({
            category: 'pago_rechazado',
            title: 'Comprobante rechazado',
            message: `La academia no pudo confirmar tu pago: ${cycle.rejectionReason}. Sube un nuevo comprobante para asegurar tu horario.`,
            recipientIds: [cycle.studentId],
            authorId: req.currentUser.id,
            meta: { cycleId: cycle.id },
        });
        await respondWithCycle(res, req.params.id);
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/cancel', auth, isAcademy, async (req, res) => {
    try {
        await cancelCycle({ cycleId: req.params.id, actor: req.currentUser });
        await respondWithCycle(res, req.params.id);
    } catch (error) {
        handleError(res, error);
    }
});

// Receipt upload: jpg, png or pdf up to 5 MB, stored outside any public folder
const RECEIPTS_DIR = path.join(UPLOADS_DIR, 'receipts');
const RECEIPT_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' };
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
            cb(null, RECEIPTS_DIR);
        },
        filename: (req, file, cb) => cb(null, `${req.params.id}-${Date.now()}${RECEIPT_TYPES[file.mimetype]}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, !!RECEIPT_TYPES[file.mimetype]),
});

// Permission and state are checked before the file is written
const checkReceiptUpload = async (req, res, next) => {
    try {
        const cycle = await Cycle.findByPk(req.params.id);
        const student = cycle && await User.findByPk(cycle.studentId);
        assertCanSubmitReceipt(cycle, req.currentUser, student);
        next();
    } catch (error) {
        handleError(res, error);
    }
};

const receiveFile = (req, res, next) => upload.single('receipt')(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'El archivo no puede pesar más de 5 MB.' });
    if (error) return handleError(res, error);
    if (!req.file) return res.status(400).json({ message: 'Adjunta el comprobante en JPG, PNG o PDF.' });
    next();
});

router.post('/:id/receipt', auth, requireRole('academy', 'student'), checkReceiptUpload, receiveFile, async (req, res) => {
    try {
        const receiptPath = path.relative(UPLOADS_DIR, req.file.path).split(path.sep).join('/');
        const { student, previousReceipt } = await submitReceipt({ cycleId: req.params.id, actor: req.currentUser, receiptPath });
        if (previousReceipt) fs.rm(path.join(UPLOADS_DIR, previousReceipt), { force: true }, () => {});

        const academy = await User.findAll({ where: { role: 'academy', active: true }, attributes: ['id'] });
        await createNotice({
            category: 'comprobante_recibido',
            title: 'Comprobante recibido',
            message: `${student.name} subió el comprobante de su mensualidad. Revísalo en Mensualidades.`,
            recipientIds: academy.map(a => a.id),
            authorId: req.currentUser.id,
            meta: { cycleId: req.params.id },
        });
        await respondWithCycle(res, req.params.id);
    } catch (error) {
        fs.rm(req.file.path, { force: true }, () => {});
        handleError(res, error);
    }
});

// The payment receipt file: the academy, the student and their teacher can open it
router.get('/:id/receipt', auth, requireRole(), async (req, res) => {
    try {
        const cycle = await Cycle.findByPk(req.params.id, { include: [{ model: User, as: 'student' }] });
        if (!cycle) return res.status(404).json({ message: 'Ciclo no encontrado' });
        if (!canViewStudent(req.currentUser, cycle.student)) return res.status(403).json({ message: 'No tienes acceso a este comprobante.' });
        if (!cycle.receiptPath) return res.status(404).json({ message: 'Este ciclo no tiene comprobante.' });

        const file = path.resolve(UPLOADS_DIR, cycle.receiptPath);
        if (!file.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(file)) {
            return res.status(404).json({ message: 'No se encontró el archivo del comprobante.' });
        }
        res.sendFile(file);
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = { router, UPLOADS_DIR, withSummaries };
