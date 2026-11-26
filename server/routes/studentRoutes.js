const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize, User, Cycle, Lesson, FixedSchedule, Room, Instrument } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { createStudent, updateStudent, resetPassword } = require('../services/accountService');
const { CYCLE_STATUS } = require('../domain/constants');
const { pendingMakeups } = require('../domain/cycles');
const { buildStudentOverview } = require('../services/studentOverviewService');
const fs = require('fs');
const path = require('path');
const { changeTeacher, archivePreview, archiveStudent, deleteArchivedStudent, restoreStudent } = require('../services/studentLifecycleService');
const { UPLOADS_DIR } = require('./cycleRoutes');
const { createCycle, confirmCyclePayment } = require('../services/cycleService');
const { notifyPaymentConfirmed } = require('../services/noticeService');
const { localDate } = require('../domain/time');
const { Payment } = require('../models');
const { paymentStanding } = require('../domain/billing');
const { getSettings } = require('../services/settingsService');
const { pendingSingleClasses } = require('../services/billingService');

const findStudent = (id) => User.findOne({ where: { id, role: 'student' } });

const OPEN_STATUSES = [CYCLE_STATUS.PENDIENTE_PAGO, CYCLE_STATUS.ACTIVO];

// Students with their teacher, fixed schedules, open cycles and owed make-ups.
// The academy sees all of them; a teacher only their own.
router.get('/', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        // Archived students are listed only on request (?archived=1, academy)
        const archived = req.currentUser.role === 'academy' && req.query.archived === '1';
        const where = { role: 'student', active: !archived };
        if (req.currentUser.role === 'teacher') where.teacherId = req.currentUser.id;

        const students = await User.findAll({
            where,
            include: [
                { model: User, as: 'Teacher', attributes: ['id', 'name'] },
                { model: Instrument, as: 'instrument', attributes: ['id', 'name'] },
            ],
            order: [['name', 'ASC']],
        });
        const ids = students.map(s => s.id);
        const [cycles, lessons, fixedSchedules, rooms] = await Promise.all([
            Cycle.findAll({ where: { studentId: ids, status: { [Op.in]: OPEN_STATUSES } }, order: [['startDate', 'ASC']] }),
            Lesson.findAll({ where: { studentId: ids } }),
            FixedSchedule.findAll({
                where: { studentId: ids, [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: localDate(new Date()) } }] },
            }),
            Room.findAll({ attributes: ['id', 'name'] }),
        ]);
        const roomName = Object.fromEntries(rooms.map(r => [r.id, r.name]));

        // Monthly billing: the payment that sums up each student (one waiting for them first, else this month's)
        const now = new Date();
        const settings = await getSettings();
        const thisMonth = localDate(now).slice(0, 7);
        const payments = await Payment.findAll({ where: { studentId: ids, status: { [Op.ne]: 'anulado' } }, order: [['createdAt', 'ASC']] });
        const paymentOf = (studentId) => {
            const own = payments.filter(p => p.studentId === studentId).map(p => p.get({ plain: true }));
            const chosen = own.find(p => ['por_pagar', 'rechazado', 'en_revision'].includes(p.status))
                || own.filter(p => p.period === thisMonth).pop()
                || null;
            return chosen && { id: chosen.id, type: chosen.type, period: chosen.period, amount: chosen.amount, status: chosen.status,
                standing: paymentStanding({ payment: chosen, now, settings }).state };
        };
        // The first month charge (mensualidad / proporcional) from this month on: the student needs a weekly time
        // for it, whatever other payments (e.g. this month's single classes) they have
        const monthChargeOf = (studentId) => {
            const charge = payments
                .filter(p => p.studentId === studentId && ['mensualidad', 'proporcional'].includes(p.type) && p.period >= thisMonth)
                .sort((a, b) => a.period.localeCompare(b.period))[0];
            return charge ? { id: charge.id, type: charge.type, period: charge.period, status: charge.status } : null;
        };

        // Single classes the academy gave that the teacher has not booked yet
        const singlesLeft = {};
        for (const single of await pendingSingleClasses({ actor: req.currentUser })) {
            singlesLeft[single.studentId] = (singlesLeft[single.studentId] || 0) + single.left;
        }

        res.json(students.map(student => {
            const own = (list) => list.filter(x => x.studentId === student.id).map(x => x.get({ plain: true }));
            const { repertoire, instrument, ...data } = student.toJSON();
            return {
                ...data,
                teacherName: student.Teacher?.name || null,
                instrumentName: instrument?.name || null,
                fixedSchedules: own(fixedSchedules).map(f => ({ ...f, roomName: roomName[f.roomId] })),
                openCycles: own(cycles),
                pendingMakeups: pendingMakeups(own(lessons)).length,
                monthlyPayment: paymentOf(student.id),
                monthCharge: monthChargeOf(student.id),
                singleClassesToBook: singlesLeft[student.id] || 0,
            };
        }));
    } catch (error) {
        handleError(res, error);
    }
});

// The logged-in student's dashboard data
router.get('/me/overview', auth, requireRole('student'), async (req, res) => {
    try {
        res.json(await buildStudentOverview(req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

// Student data plus, optionally, the first cycle: { ..., cycle: { plan, startDate?, paid } }.
// With paid, the payment is confirmed and the teacher is asked to schedule the classes.
router.post('/', auth, requireRole('academy'), async (req, res) => {
    try {
        const { cycle: cycleData, ...studentData } = req.body;
        const { student, tempPassword, cycle } = await sequelize.transaction(async (transaction) => {
            const created = await createStudent(studentData, { transaction });
            const firstCycle = cycleData
                ? await createCycle({
                    studentId: created.student.id, plan: cycleData.plan, startDate: cycleData.startDate || localDate(new Date()),
                    actor: req.currentUser, transaction,
                })
                : null;
            return { ...created, cycle: firstCycle };
        });
        if (cycle && cycleData.paid) {
            const confirmation = await confirmCyclePayment({ cycleId: cycle.id, actor: req.currentUser });
            await notifyPaymentConfirmed({ ...confirmation, actor: req.currentUser });
        }
        res.status(201).json({ student: student.toJSON(), tempPassword });
    } catch (error) {
        handleError(res, error);
    }
});

// Changing teacherId hands the student over to the new teacher (see changeTeacher)
router.put('/:id', auth, requireRole('academy'), async (req, res) => {
    try {
        const student = await findStudent(req.params.id);
        if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' });
        const { teacherId, active, ...data } = req.body;
        await updateStudent(student, data, { teacherId: teacherId === undefined ? student.teacherId : teacherId || null });
        if (teacherId !== undefined && (teacherId || null) !== student.teacherId) {
            await changeTeacher({ student, newTeacherId: teacherId || null, actor: req.currentUser });
        }
        res.json((await student.reload()).toJSON());
    } catch (error) {
        handleError(res, error);
    }
});

// What archiving would lose: { upcoming, owed, activeCycles, chargesToAnnul }
router.get('/:id/archive-preview', auth, requireRole('academy'), async (req, res) => {
    try {
        const student = await findStudent(req.params.id);
        if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' });
        res.json(await archivePreview({ student }));
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/archive', auth, requireRole('academy'), async (req, res) => {
    try {
        const student = await findStudent(req.params.id);
        if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' });
        const { lostClasses, annulledCharges } = await archiveStudent({ student, actor: req.currentUser });
        res.json({ message: 'Estudiante archivado', lostClasses, annulledCharges });
    } catch (error) {
        handleError(res, error);
    }
});

// Permanently deletes an archived student and their history
router.delete('/:id', auth, requireRole('academy'), async (req, res) => {
    try {
        const student = await findStudent(req.params.id);
        if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' });
        const { receipts } = await deleteArchivedStudent({ student, actor: req.currentUser });
        for (const receipt of receipts) fs.rm(path.join(UPLOADS_DIR, receipt), { force: true }, () => {});
        res.json({ message: 'Estudiante eliminado' });
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/restore', auth, requireRole('academy'), async (req, res) => {
    try {
        const student = await findStudent(req.params.id);
        if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' });
        await restoreStudent({ student, actor: req.currentUser });
        res.json({ message: 'Estudiante restaurado' });
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/reset-password', auth, requireRole('academy'), async (req, res) => {
    try {
        const student = await User.findOne({ where: { id: req.params.id, role: 'student' } });
        if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' });
        const tempPassword = await resetPassword(student);
        res.json({ tempPassword });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
