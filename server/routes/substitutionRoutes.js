const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const {
    listAbsences, createAbsence, getAbsenceDetail, assignSubstitute, removeSubstitute, uncoveredLessonIds,
    deleteAbsence, notifyAssigned, notifyReleased, buildReport,
} = require('../services/substitutionService');
const { cancelLessons } = require('../services/lessonService');
const { notifyCancellations } = require('../services/noticeService');
const { localDate } = require('../domain/time');

// Absences and substitutes are managed by the academy only
const isAcademy = requireRole('academy');

// Absences that have not ended (?all=1 also the past ones)
router.get('/absences', auth, isAcademy, async (req, res) => {
    try {
        res.json(await listAbsences({ includePast: req.query.all === '1' }));
    } catch (error) {
        handleError(res, error);
    }
});

// { teacherId, startDate, endDate, reason? }
router.post('/absences', auth, isAcademy, async (req, res) => {
    try {
        res.status(201).json(await createAbsence({ ...req.body, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

router.get('/absences/:id', auth, isAcademy, async (req, res) => {
    try {
        res.json(await getAbsenceDetail({ id: req.params.id }));
    } catch (error) {
        handleError(res, error);
    }
});

// The upcoming lessons go back to their teacher and the students are told
router.delete('/absences/:id', auth, isAcademy, async (req, res) => {
    try {
        const { released } = await deleteAbsence({ id: req.params.id, actor: req.currentUser });
        await notifyReleased({ lessons: released, actor: req.currentUser });
        res.json({ message: 'Ausencia eliminada', released: released.length });
    } catch (error) {
        handleError(res, error);
    }
});

// Cancels the upcoming lessons of the absence that have no substitute: a make-up is owed. { reason? }
router.post('/absences/:id/cancel-uncovered', auth, isAcademy, async (req, res) => {
    try {
        const { absence, lessonIds } = await uncoveredLessonIds({ id: req.params.id });
        if (!lessonIds.length) return res.json([]);
        const reason = String(req.body.reason || absence.reason || 'Ausencia del profesor').trim();
        const cancelled = await cancelLessons({ lessonIds, actor: req.currentUser, reason });
        await notifyCancellations(cancelled, req.currentUser);
        res.json(cancelled);
    } catch (error) {
        handleError(res, error);
    }
});

// { lessonIds, substitute: { teacherId } | { name, phone? } }
router.post('/assign', auth, isAcademy, async (req, res) => {
    try {
        const { lessons, substituteName } = await assignSubstitute({ lessonIds: req.body.lessonIds, substitute: req.body.substitute, actor: req.currentUser });
        await notifyAssigned({ lessons, substituteName, substituteTeacherId: lessons[0]?.substituteTeacherId, actor: req.currentUser });
        res.json({ assigned: lessons.length });
    } catch (error) {
        handleError(res, error);
    }
});

// { lessonIds }: back to their own teacher
router.post('/remove', auth, isAcademy, async (req, res) => {
    try {
        const released = await removeSubstitute({ lessonIds: req.body.lessonIds, actor: req.currentUser });
        await notifyReleased({ lessons: released, actor: req.currentUser });
        res.json({ released: released.length });
    } catch (error) {
        handleError(res, error);
    }
});

// ?month=YYYY-MM (default: this month)
router.get('/report', auth, isAcademy, async (req, res) => {
    try {
        const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : localDate(new Date()).slice(0, 7);
        res.json(await buildReport({ month }));
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
