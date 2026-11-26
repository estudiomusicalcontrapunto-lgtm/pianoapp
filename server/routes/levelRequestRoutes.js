const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { LevelRequest, User } = require('../models');
const {
    listLevelRequests, createLevelRequest, cancelLevelRequest, scheduleShowcase, approveLevelRequest, rejectLevelRequest,
} = require('../services/levelRequestService');

const isAcademy = requireRole('academy');
const isTeacher = requireRole('teacher');

const requestJSON = (request) => {
    const { student, teacher, ...data } = request.get({ plain: true });
    return {
        ...data,
        studentName: student?.name || null,
        studentLevel: student?.level ?? null,
        teacherName: teacher?.name || null,
    };
};

const reload = async (id) => requestJSON(await LevelRequest.findByPk(id, {
    include: [
        { model: User, as: 'student', attributes: ['id', 'name', 'level'] },
        { model: User, as: 'teacher', attributes: ['id', 'name'] },
    ],
}));

// ?studentId= &open=1 (only pending or with a scheduled showcase)
router.get('/', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        const requests = await listLevelRequests({ actor: req.currentUser, studentId: req.query.studentId, open: req.query.open === '1' });
        res.json(requests.map(requestJSON));
    } catch (error) {
        handleError(res, error);
    }
});

// { studentId, modality: 'videos' | 'muestra', toLevel, pieces: [{ category, title, composer, videoUrl }], notes? }
router.post('/', auth, isTeacher, async (req, res) => {
    try {
        const request = await createLevelRequest({ data: req.body, actor: req.currentUser });
        res.status(201).json(await reload(request.id));
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/:id/cancel', auth, isTeacher, async (req, res) => {
    try {
        await cancelLevelRequest({ id: req.params.id, actor: req.currentUser });
        res.json(await reload(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

// { showcaseAt, showcasePlace }
router.post('/:id/schedule', auth, isAcademy, async (req, res) => {
    try {
        await scheduleShowcase({ id: req.params.id, ...req.body, actor: req.currentUser });
        res.json(await reload(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

// { note? }
router.post('/:id/approve', auth, isAcademy, async (req, res) => {
    try {
        await approveLevelRequest({ id: req.params.id, note: req.body.note, actor: req.currentUser });
        res.json(await reload(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

// { reason }
router.post('/:id/reject', auth, isAcademy, async (req, res) => {
    try {
        await rejectLevelRequest({ id: req.params.id, reason: req.body.reason, actor: req.currentUser });
        res.json(await reload(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
