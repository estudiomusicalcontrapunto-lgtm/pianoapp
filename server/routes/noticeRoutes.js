const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { listNoticesFor, listRecentNoticesFor, markRead } = require('../services/noticeService');
const { listForReader, markAnnouncementsRead } = require('../services/announcementService');
const { getSettings } = require('../services/settingsService');

// The "Avisos" card: current announcements first, then the system notices that
// are unread or recent. Old read notices and expired announcements are left out.
router.get('/feed', auth, requireRole(), async (req, res) => {
    try {
        const settings = await getSettings();
        const [announcements, notifications] = await Promise.all([
            listForReader(req.currentUser),
            listRecentNoticesFor(req.currentUser.id, { keepReadDays: settings.dias_avisos_leidos }),
        ]);
        const unread = announcements.filter(a => !a.readAt).length + notifications.filter(n => !n.readAt).length;
        res.json({ announcements, notifications, unread, keepReadDays: settings.dias_avisos_leidos });
    } catch (error) {
        handleError(res, error);
    }
});

// Everything, including expired announcements and old notices
router.get('/history', auth, requireRole(), async (req, res) => {
    try {
        const [announcements, notifications] = await Promise.all([
            listForReader(req.currentUser, { includeExpired: true }),
            listNoticesFor(req.currentUser.id, { limit: 200 }),
        ]);
        res.json({ announcements, notifications });
    } catch (error) {
        handleError(res, error);
    }
});

// The current user's notices, newest first
router.get('/', auth, requireRole(), async (req, res) => {
    try {
        res.json(await listNoticesFor(req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

// { noticeIds?, announcementIds? } — with neither, marks everything as read
router.post('/read', auth, requireRole(), async (req, res) => {
    try {
        const { noticeIds, announcementIds } = req.body;
        const all = !noticeIds && !announcementIds;
        if (all || noticeIds) await markRead(req.currentUser.id, noticeIds);
        if (all || announcementIds) await markAnnouncementsRead(req.currentUser, announcementIds);
        res.json({ message: 'Avisos leídos' });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
