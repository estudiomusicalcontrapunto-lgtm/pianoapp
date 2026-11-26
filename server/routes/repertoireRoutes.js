const express = require('express');
const router = express.Router();
const { User, Repertoire } = require('../models');
const auth = require('../middleware/auth');

// Add repertoire to student
router.post('/:studentId', auth, async (req, res) => {
    try {
        const student = await User.findOne({ where: { id: req.params.studentId, teacherId: req.user } });
        if (!student) return res.status(404).json({ message: 'Student not found or access denied' });

        const pieceData = req.body;
        
        await Repertoire.create({
            ...pieceData,
            studentId: student.id,
            status: 'learning',
            progress: 0,
            currentMeasure: 0,
            repetitions: 0,
            riskMap: {}
        });

        // Return updated student with all repertoire
        const updatedStudent = await User.findByPk(student.id, {
            include: [{ model: Repertoire, as: 'repertoire' }]
        });
        
        res.json(updatedStudent.toJSON());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Update repertoire field (dynamic update)
router.put('/:studentId/:repertoireId', auth, async (req, res) => {
    try {
        const student = await User.findByPk(req.params.studentId);
        if (!student) return res.status(404).json({ message: 'Student not found' });

        // Check permissions: either it's the student themselves, or their teacher
        if (req.user !== student.id && req.user !== student.teacherId) {
             return res.status(403).json({ message: 'Access denied' });
        }

        const rep = await Repertoire.findOne({ where: { id: req.params.repertoireId, studentId: student.id } });
        if (!rep) return res.status(404).json({ message: 'Repertoire not found' });

        const updates = req.body;
        
        // Allowed fields to update
        ['progress', 'currentMeasure', 'repetitions', 'studentNotes', 'teacherNotes', 'riskMap', 'pdfUrl', 'status'].forEach(field => {
            if (updates[field] !== undefined) {
                if (field === 'repetitions' && updates.increment) {
                   rep.repetitions = (rep.repetitions || 0) + updates.increment;
                } else {
                   rep[field] = updates[field];
                }
            }
        });

        await rep.save();
        
        const updatedStudent = await User.findByPk(student.id, {
            include: [{ model: Repertoire, as: 'repertoire' }]
        });
        res.json(updatedStudent.toJSON());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Delete repertoire
router.delete('/:studentId/:repertoireId', auth, async (req, res) => {
    try {
        const student = await User.findOne({ where: { id: req.params.studentId, teacherId: req.user } });
        if (!student) return res.status(404).json({ message: 'Student not found or access denied' });

        await Repertoire.destroy({ where: { id: req.params.repertoireId, studentId: student.id } });
        
        const updatedStudent = await User.findByPk(student.id, {
            include: [{ model: Repertoire, as: 'repertoire' }]
        });
        res.json(updatedStudent.toJSON());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
