const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { UPLOADS_DIR } = require('./cycleRoutes');
const {
    assertEditable, getGuide, saveRequirement, addLink, addPdf, removeResource, getResourceFile,
} = require('../services/levelGuideService');

const isAcademy = requireRole('academy');

// The guide of one instrument: every level with its requirements and attachments
router.get('/:instrumentId', auth, requireRole(), async (req, res) => {
    try {
        res.json(await getGuide({ instrumentId: req.params.instrumentId, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// { description }: an empty text removes the level's requirements
router.put('/:instrumentId/:level', auth, isAcademy, async (req, res) => {
    try {
        const { instrumentId, level } = req.params;
        res.json(await saveRequirement({ instrumentId, level, description: req.body.description, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// { title, url }
router.post('/:instrumentId/:level/links', auth, isAcademy, async (req, res) => {
    try {
        const { instrumentId, level } = req.params;
        res.status(201).json(await addLink({ instrumentId, level, title: req.body.title, url: req.body.url, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// PDF upload: up to 10 MB, stored outside any public folder
const MAX_PDF_MB = 10;
const GUIDES_DIR = path.join(UPLOADS_DIR, 'grados');
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdirSync(GUIDES_DIR, { recursive: true });
            cb(null, GUIDES_DIR);
        },
        filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
    }),
    limits: { fileSize: MAX_PDF_MB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

// The target is checked before the file is written
const checkTarget = async (req, res, next) => {
    try {
        await assertEditable(req.params.instrumentId, req.params.level);
        next();
    } catch (error) {
        handleError(res, error);
    }
};

const receiveFile = (req, res, next) => upload.single('file')(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: `El PDF no puede pesar más de ${MAX_PDF_MB} MB.` });
    if (error) return handleError(res, error);
    if (!req.file) return res.status(400).json({ message: 'Adjunta un archivo PDF.' });
    // The browser's type is not proof: a real PDF starts with "%PDF-"
    const head = Buffer.alloc(5);
    const fd = fs.openSync(req.file.path, 'r');
    fs.readSync(fd, head, 0, 5, 0);
    fs.closeSync(fd);
    if (head.toString('latin1') !== '%PDF-') {
        fs.rm(req.file.path, { force: true }, () => {});
        return res.status(400).json({ message: 'El archivo no es un PDF válido.' });
    }
    next();
});

// multipart: file (PDF) and an optional title
router.post('/:instrumentId/:level/files', auth, isAcademy, checkTarget, receiveFile, async (req, res) => {
    try {
        const { instrumentId, level } = req.params;
        // Browsers send the file name as latin1 in multipart headers
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const resource = await addPdf({
            instrumentId, level, title: req.body.title, actor: req.currentUser,
            file: { path: path.relative(UPLOADS_DIR, req.file.path).split(path.sep).join('/'), originalName, size: req.file.size },
        });
        res.status(201).json(resource);
    } catch (error) {
        fs.rm(req.file.path, { force: true }, () => {});
        handleError(res, error);
    }
});

router.delete('/resources/:id', auth, isAcademy, async (req, res) => {
    try {
        const { filePath } = await removeResource({ id: req.params.id, actor: req.currentUser });
        if (filePath) fs.rm(path.join(UPLOADS_DIR, filePath), { force: true }, () => {});
        res.json({ message: 'Adjunto eliminado' });
    } catch (error) {
        handleError(res, error);
    }
});

router.get('/resources/:id/file', auth, requireRole(), async (req, res) => {
    try {
        const resource = await getResourceFile({ id: req.params.id, actor: req.currentUser });
        const file = path.resolve(UPLOADS_DIR, resource.filePath);
        if (!file.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(file)) {
            return res.status(404).json({ message: 'No se encontró el archivo.' });
        }
        res.type('application/pdf').sendFile(file);
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
