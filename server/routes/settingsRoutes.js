const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { SETTING_DEFINITIONS } = require('../domain/settings');
const { getSettings, updateSettings } = require('../services/settingsService');

// Every role reads the rules (students see the notice period and prices)
router.get('/', auth, requireRole(), async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({ settings, definitions: SETTING_DEFINITIONS });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.put('/', auth, requireRole('academy'), async (req, res) => {
    try {
        const result = await updateSettings(req.body, req.currentUser.id);
        if (result.errors) {
            return res.status(400).json({ message: result.errors.join(' '), errors: result.errors });
        }
        res.json({ settings: result.settings, definitions: SETTING_DEFINITIONS });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
