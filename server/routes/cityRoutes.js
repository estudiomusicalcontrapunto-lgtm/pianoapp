const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { listCities, createCity, updateCity, deleteCity } = require('../services/cityService');

// Cities with their fees and payment text
router.get('/', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        res.json(await listCities({ includeInactive: req.currentUser.role === 'academy' }));
    } catch (error) {
        handleError(res, error);
    }
});

// { name, monthlyFee, singleClassFee?, paymentText? }
router.post('/', auth, requireRole('academy'), async (req, res) => {
    try {
        res.status(201).json(await createCity({ input: req.body, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

router.put('/:id', auth, requireRole('academy'), async (req, res) => {
    try {
        res.json(await updateCity({ cityId: req.params.id, input: req.body, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// Only a city nobody uses (see deleteCity)
router.delete('/:id', auth, requireRole('academy'), async (req, res) => {
    try {
        await deleteCity({ cityId: req.params.id, actor: req.currentUser });
        res.json({ message: 'Ciudad eliminada' });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
