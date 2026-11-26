const express = require('express');
const router = express.Router();
const { Assessment, User, Room } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { isHoldActive } = require('../domain/holds');
const {
    createAssessment, updateAssessment, holdSlot, releaseHold, convertAssessment,
} = require('../services/assessmentService');

const isAcademy = requireRole('academy');

const assessmentJSON = (assessment, now = new Date()) => ({
    ...assessment.get({ plain: true }),
    teacherName: assessment.teacher?.name || null,
    holdRoomName: assessment.holdRoom?.name || null,
    holdActive: isHoldActive(assessment, now),
});

const include = [
    { model: User, as: 'teacher', attributes: ['id', 'name'] },
    { model: Room, as: 'holdRoom', attributes: ['id', 'name'] },
];

const reload = async (id) => assessmentJSON(await Assessment.findByPk(id, { include }));

router.get('/', auth, isAcademy, async (req, res) => {
    try {
        const assessments = await Assessment.findAll({ include, order: [['scheduledAt', 'DESC']] });
        res.json(assessments.map(a => assessmentJSON(a)));
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/', auth, isAcademy, async (req, res) => {
    try {
        const assessment = await createAssessment({ data: req.body, actor: req.currentUser });
        res.status(201).json(await reload(assessment.id));
    } catch (error) {
        handleError(res, error);
    }
});

router.put('/:id', auth, isAcademy, async (req, res) => {
    try {
        await updateAssessment({ id: req.params.id, data: req.body, actor: req.currentUser });
        res.json(await reload(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

// Hold a weekly slot: { roomId, weekday, startTime, durationMinutes? }
router.post('/:id/hold', auth, isAcademy, async (req, res) => {
    try {
        await holdSlot({ id: req.params.id, ...req.body, actor: req.currentUser });
        res.json(await reload(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/release', auth, isAcademy, async (req, res) => {
    try {
        await releaseHold({ id: req.params.id, actor: req.currentUser });
        res.json(await reload(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

// Payment received: { email, plan, startDate? } -> student, fixed schedule and paid cycle
router.post('/:id/convert', auth, isAcademy, async (req, res) => {
    try {
        const result = await convertAssessment({ id: req.params.id, ...req.body, actor: req.currentUser });
        res.status(201).json({ ...result, assessment: await reload(req.params.id) });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
