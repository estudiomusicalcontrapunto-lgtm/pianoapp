const express = require('express');
const router = express.Router();
const { User, Repertoire, Instrument, City } = require('../models');
const { resolvePrices } = require('../domain/pricing');
const { assertActiveCity, defaultCityId, updateTeacherBilling } = require('../services/cityService');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const handleError = require('./handleError');
const { buildAcademyOverview } = require('../services/academyOverviewService');
const { runMaintenance } = require('../services/maintenanceService');
const { removeTeacher } = require('../services/studentLifecycleService');
const { setTeacherInstruments } = require('../services/instrumentService');

const isAcademy = requireRole('academy');

// Create a new teacher with the instruments they teach (instrumentIds)
router.post('/teachers', auth, isAcademy, async (req, res) => {
    try {
        const { email, password, name, instrumentIds = [] } = req.body;
        if (!instrumentIds.length) {
            return res.status(400).json({ message: 'Elige al menos un instrumento que enseñe.' });
        }

        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'El email ya está registrado' });
        }
        const cityId = req.body.cityId
            ? (await assertActiveCity(req.body.cityId)).id
            : await defaultCityId();

        const newTeacher = await User.create({
            email,
            password, // Password will be hashed by the beforeSave hook in User model
            name,
            role: 'teacher',
            cityId,
        });
        try {
            await setTeacherInstruments({ teacherId: newTeacher.id, instrumentIds, actor: req.currentUser });
        } catch (error) {
            await newTeacher.destroy();
            throw error;
        }

        res.status(201).json({ ...newTeacher.toJSON(), instrumentIds });
    } catch (error) {
        handleError(res, error);
    }
});

// Replaces the instruments a teacher teaches
router.put('/teachers/:id/instruments', auth, isAcademy, async (req, res) => {
    try {
        const instrumentIds = req.body.instrumentIds || [];
        if (!instrumentIds.length) {
            return res.status(400).json({ message: 'Elige al menos un instrumento que enseñe.' });
        }
        const instruments = await setTeacherInstruments({ teacherId: req.params.id, instrumentIds, actor: req.currentUser });
        res.json({ id: req.params.id, instrumentIds: instruments.map(i => i.id) });
    } catch (error) {
        handleError(res, error);
    }
});

// A teacher's city: { cityId }. Prices and payment text are per city only (the academy collects).
router.put('/teachers/:id/billing', auth, isAcademy, async (req, res) => {
    try {
        const teacher = await updateTeacherBilling({ teacherId: req.params.id, input: req.body, actor: req.currentUser });
        res.json(teacher.toJSON());
    } catch (error) {
        handleError(res, error);
    }
});

// Get all teachers and their students
router.get('/teachers', auth, isAcademy, async (req, res) => {
    try {
        const found = await User.findAll({
            where: { role: 'teacher', active: true },
            attributes: { exclude: ['password'] },
            include: [
                { model: Instrument, as: 'instruments', attributes: ['id', 'name'], through: { attributes: [] } },
                { model: City, as: 'city' },
            ],
        });
        const teachers = found.map(t => {
            const { instruments, city, ...data } = t.toJSON();
            return {
                ...data,
                instrumentIds: instruments.map(i => i.id),
                instrumentNames: instruments.map(i => i.name),
                cityName: city?.name || null,
                // What this teacher's students pay: their city's prices
                prices: city ? resolvePrices({ city }) : null,
            };
        });

        // Fetch students for each teacher
        const teachersWithStudents = await Promise.all(teachers.map(async (teacher) => {
            const students = await User.findAll({
                where: { role: 'student', teacherId: teacher.id, active: true },
                include: [{ model: Repertoire, as: 'repertoire' }],
                attributes: { exclude: ['password'] }
            });
            return {
                ...teacher,
                students: students
            };
        }));

        res.json(teachersWithStudents);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Removes a teacher (their students must be reassigned first)
router.delete('/teachers/:id', auth, isAcademy, async (req, res) => {
    try {
        const teacher = await User.findOne({ where: { id: req.params.id, role: 'teacher', active: true } });
        if (!teacher) return res.status(404).json({ message: 'Profesor no encontrado' });
        await removeTeacher({ teacher, actor: req.currentUser });
        res.json({ message: 'Profesor eliminado' });
    } catch (error) {
        handleError(res, error);
    }
});

// Home panel. ?month=YYYY-MM for the projected income (default: this month)
router.get('/overview', auth, isAcademy, async (req, res) => {
    try {
        res.json(await buildAcademyOverview({ month: req.query.month }));
    } catch (error) {
        handleError(res, error);
    }
});

// Runs the scheduled tasks now (they also run on a timer)
router.post('/maintenance/run', auth, isAcademy, async (req, res) => {
    try {
        res.json(await runMaintenance());
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
