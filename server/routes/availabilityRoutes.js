const express = require('express');
const router = express.Router();
const { Availability, Room } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { saveAvailability, removeAvailability } = require('../services/availabilityService');

const canEdit = requireRole('academy', 'teacher');

// A teacher's active windows. The academy may pass ?teacherId=
router.get('/', auth, canEdit, async (req, res) => {
    try {
        const where = { active: true };
        if (req.currentUser.role === 'teacher') where.teacherId = req.currentUser.id;
        else if (req.query.teacherId) where.teacherId = req.query.teacherId;
        const windows = await Availability.findAll({
            where,
            include: [{ model: Room, as: 'room', attributes: ['id', 'name'] }],
            order: [['weekday', 'ASC'], ['startTime', 'ASC']],
        });
        res.json(windows.map(w => ({ ...w.get({ plain: true }), roomName: w.room?.name })));
    } catch (error) {
        handleError(res, error);
    }
});

// { roomId, weekday, startTime, endTime, type: 'clase'|'reposicion', capacity?, teacherId? (academy) }
router.post('/', auth, canEdit, async (req, res) => {
    try {
        res.status(201).json(await saveAvailability({ data: req.body, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

router.put('/:id', auth, canEdit, async (req, res) => {
    try {
        res.json(await saveAvailability({ id: req.params.id, data: req.body, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

router.delete('/:id', auth, canEdit, async (req, res) => {
    try {
        await removeAvailability({ id: req.params.id, actor: req.currentUser });
        res.json({ message: 'Franja quitada' });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
