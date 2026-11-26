// Terms and conditions: students read and accept them; the academy publishes versions.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { currentVersion, statusFor, publishTerms, acceptTerms, termsOverview } = require('../services/termsService');

// The current version and where the logged-in user stands with it
router.get('/current', auth, requireRole(), async (req, res) => {
    try {
        const version = await currentVersion();
        res.json({
            version: version && { id: version.id, version: version.version, content: version.content, acceptBy: version.acceptBy, publishedAt: version.createdAt },
            status: await statusFor(req.currentUser),
        });
    } catch (error) {
        handleError(res, error);
    }
});

// { versionId }: the date, time and version accepted are recorded
router.post('/accept', auth, requireRole('student'), async (req, res) => {
    try {
        const acceptance = await acceptTerms({
            user: req.currentUser,
            versionId: req.body.versionId,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });
        res.json({ acceptance, status: await statusFor(req.currentUser) });
    } catch (error) {
        handleError(res, error);
    }
});

// Academy: versions, and who accepted the current one
router.get('/', auth, requireRole('academy'), async (req, res) => {
    try {
        res.json(await termsOverview());
    } catch (error) {
        handleError(res, error);
    }
});

// Academy publishes a new version: { content, acceptBy? }
router.post('/', auth, requireRole('academy'), async (req, res) => {
    try {
        res.status(201).json(await publishTerms({ content: req.body.content, acceptBy: req.body.acceptBy || null, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
