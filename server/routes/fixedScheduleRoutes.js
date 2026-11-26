const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { FixedSchedule, User, Room } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { localDate, formatDay, WEEKDAY_NAMES } = require('../domain/time');
const { createNotice } = require('../services/noticeService');
const { addFixedSchedule, changeFixedSchedule, endFixedSchedule } = require('../services/fixedScheduleService');

const canEdit = requireRole('academy', 'teacher');

// Fixed schedules in force today or later. Teacher: their students. Academy: all, or ?studentId=
router.get('/', auth, canEdit, async (req, res) => {
    try {
        const where = { [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: localDate(new Date()) } }] };
        if (req.currentUser.role === 'teacher') where.teacherId = req.currentUser.id;
        if (req.query.studentId) where.studentId = req.query.studentId;
        const rows = await FixedSchedule.findAll({
            where,
            include: [
                { model: User, as: 'student', attributes: ['id', 'name'] },
                { model: Room, as: 'room', attributes: ['id', 'name'] },
            ],
            order: [['weekday', 'ASC'], ['startTime', 'ASC']],
        });
        res.json(rows.map(f => ({ ...f.get({ plain: true }), studentName: f.student?.name, roomName: f.room?.name })));
    } catch (error) {
        handleError(res, error);
    }
});

// { studentId, roomId, weekday, startTime, durationMinutes?, validFrom?, startChoice? }. A teacher assigns their own students.
// With 1 class or none left in the month it answers 409 'sugerir_mes_siguiente' (details: nextMonthStart,
// canStartNow...); send again with startChoice 'next_month' or 'now'.
router.post('/', auth, canEdit, async (req, res) => {
    try {
        const teacherId = req.currentUser.role === 'teacher' ? req.currentUser.id : req.body.teacherId;
        res.status(201).json(await addFixedSchedule({ data: { ...req.body, teacherId }, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// Same body as POST /, nothing saved: where the classes would go (dates, months, or reserved without a charge)
router.post('/preview', auth, canEdit, async (req, res) => {
    try {
        const teacherId = req.currentUser.role === 'teacher' ? req.currentUser.id : req.body.teacherId;
        res.json(await addFixedSchedule({ data: { ...req.body, teacherId }, actor: req.currentUser, dryRun: true }));
    } catch (error) {
        handleError(res, error);
    }
});

// Move to another slot: { roomId?, weekday?, startTime?, durationMinutes?, moveUpcoming? | effectiveFrom? }
router.put('/:id', auth, canEdit, async (req, res) => {
    try {
        const result = await changeFixedSchedule({ id: req.params.id, data: req.body, actor: req.currentUser });
        const { fixed, movedLessons } = result;
        await createNotice({
            category: 'horario_cambiado',
            title: 'Cambio de horario',
            message: `Tu horario de clase ahora es los ${WEEKDAY_NAMES[fixed.weekday]} a las ${fixed.startTime}.`
                + (movedLessons.length ? ` Tus próximas ${movedLessons.length} clase(s) ya quedaron en el nuevo horario.` : ` Aplica desde el ${formatDay(fixed.validFrom)}.`),
            recipientIds: [fixed.studentId],
            authorId: req.currentUser.id,
        });
        res.json(result);
    } catch (error) {
        handleError(res, error);
    }
});

// End it: { endDate? } (default today)
router.delete('/:id', auth, canEdit, async (req, res) => {
    try {
        await endFixedSchedule({ id: req.params.id, actor: req.currentUser, endDate: req.body?.endDate });
        res.json({ message: 'Horario fijo terminado' });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
