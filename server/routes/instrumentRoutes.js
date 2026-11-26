const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { UPLOADS_DIR } = require('./cycleRoutes');
const { listInstruments, createInstrument, updateInstrument } = require('../services/instrumentService');
const { getLadder, addLevel, renameLevel, reorderLevels, deleteLevel } = require('../services/levelLadderService');

const isAcademy = requireRole('academy');

// Active instruments with their levels; the academy can ask for the inactive ones too (?all=1)
router.get('/', auth, requireRole(), async (req, res) => {
    try {
        const includeInactive = req.currentUser.role === 'academy' && req.query.all === '1';
        res.json(await listInstruments({ includeInactive }));
    } catch (error) {
        handleError(res, error);
    }
});

// A new instrument starts with the standard ladder of levels
router.post('/', auth, isAcademy, async (req, res) => {
    try {
        res.status(201).json(await createInstrument({ name: req.body.name, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

router.put('/:id', auth, isAcademy, async (req, res) => {
    try {
        const { name, active } = req.body;
        res.json(await updateInstrument({ id: req.params.id, name, active, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// --- Levels of an instrument, lowest first. Every write answers with the new ladder: { levels } ---

router.get('/:id/levels', auth, requireRole(), async (req, res) => {
    try {
        res.json({ levels: await getLadder(req.params.id) });
    } catch (error) {
        handleError(res, error);
    }
});

// { name, position? } (position 0 = lowest; default: on top)
router.post('/:id/levels', auth, isAcademy, async (req, res) => {
    try {
        const levels = await addLevel({ instrumentId: req.params.id, name: req.body.name, position: req.body.position, actor: req.currentUser });
        res.status(201).json({ levels });
    } catch (error) {
        handleError(res, error);
    }
});

// { from, to }
router.put('/:id/levels/rename', auth, isAcademy, async (req, res) => {
    try {
        res.json({ levels: await renameLevel({ instrumentId: req.params.id, from: req.body.from, to: req.body.to, actor: req.currentUser }) });
    } catch (error) {
        handleError(res, error);
    }
});

// { names }: all the levels in the new order
router.put('/:id/levels/order', auth, isAcademy, async (req, res) => {
    try {
        res.json({ levels: await reorderLevels({ instrumentId: req.params.id, names: req.body.names, actor: req.currentUser }) });
    } catch (error) {
        handleError(res, error);
    }
});

router.delete('/:id/levels/:name', auth, isAcademy, async (req, res) => {
    try {
        const { ladder, files } = await deleteLevel({ instrumentId: req.params.id, name: req.params.name, actor: req.currentUser });
        for (const file of files) fs.rm(path.join(UPLOADS_DIR, file), { force: true }, () => {});
        res.json({ levels: ladder });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
