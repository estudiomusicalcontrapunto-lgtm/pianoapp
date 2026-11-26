const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const {
    listManaged, createAnnouncement, updateAnnouncement, endAnnouncement, deleteAnnouncement,
} = require('../services/announcementService');

// Readers get announcements through /notices/feed; this is what authors manage.
// The academy sees every announcement, a teacher their own.
const isAuthor = requireRole('academy', 'teacher');

router.get('/', auth, isAuthor, async (req, res) => {
    try {
        res.json(await listManaged(req.currentUser));
    } catch (error) {
        handleError(res, error);
    }
});

// { title, content, visibleUntil?, audience? (academy: todos | estudiantes | profesores) }
router.post('/', auth, isAuthor, async (req, res) => {
    try {
        res.status(201).json(await createAnnouncement({ actor: req.currentUser, input: req.body }));
    } catch (error) {
        handleError(res, error);
    }
});

router.put('/:id', auth, isAuthor, async (req, res) => {
    try {
        res.json(await updateAnnouncement({ id: req.params.id, actor: req.currentUser, input: req.body }));
    } catch (error) {
        handleError(res, error);
    }
});

// Stops showing it today; it stays in the history
router.post('/:id/end', auth, isAuthor, async (req, res) => {
    try {
        res.json(await endAnnouncement({ id: req.params.id, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

router.delete('/:id', auth, isAuthor, async (req, res) => {
    try {
        await deleteAnnouncement({ id: req.params.id, actor: req.currentUser });
        res.json({ message: 'Anuncio eliminado' });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
