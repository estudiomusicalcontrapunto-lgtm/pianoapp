const express = require('express');
const router = express.Router();
const { User, Repertoire, Instrument } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { canViewStudent } = require('../domain/permissions');
const { markPracticeToday, getPracticeWeek, practicedThisWeek } = require('../services/practiceService');

// Get current user profile, with the student's instrument or the teacher's instruments
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findByPk(req.user, {
            include: [
                { model: Repertoire, as: 'repertoire' },
                { model: Instrument, as: 'instrument', attributes: ['id', 'name'] },
                { model: Instrument, as: 'instruments', attributes: ['id', 'name'], through: { attributes: [] } },
            ]
        });
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user.toJSON());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get students for a teacher
router.get('/students', auth, async (req, res) => {
    try {
        const teacher = await User.findByPk(req.user);
        if (teacher.role !== 'teacher') {
            return res.status(403).json({ message: 'Only teachers can fetch students' });
        }

        const students = await User.findAll({
            where: { role: 'student', teacherId: teacher.id },
            include: [
                { model: Repertoire, as: 'repertoire' },
                { model: Instrument, as: 'instrument', attributes: ['id', 'name'] },
            ]
        });
        // This week's practiced days, for the flames next to each student
        const week = await practicedThisWeek(students.map(s => s.id));

        res.json(students.map(s => ({ ...s.toJSON(), practiceWeek: week[s.id] })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// The student marks today as practiced (only today, once). Answers with { streak, lastPractice }.
router.post('/practice', auth, requireRole('student'), async (req, res) => {
    try {
        const student = await markPracticeToday({ studentId: req.currentUser.id });
        const { streak, lastPractice } = student.toJSON();
        res.json({ streak, lastPractice });
    } catch (error) {
        handleError(res, error);
    }
});

// One week of a student's practice: the student, their teacher or the academy. ?weekStart=YYYY-MM-DD
router.get('/:id/practice', auth, requireRole(), async (req, res) => {
    try {
        const student = await User.findByPk(req.params.id);
        if (!canViewStudent(req.currentUser, student)) return res.status(403).json({ message: 'No tienes acceso a este estudiante.' });
        res.json(await getPracticeWeek({ student, weekStart: req.query.weekStart }));
    } catch (error) {
        handleError(res, error);
    }
});

// Levels are no longer changed here: the teacher sends a level-up request
// (/api/level-requests) and the academy approves it.

module.exports = router;
