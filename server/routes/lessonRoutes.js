const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Lesson, User, Room, Cycle } = require('../models');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { pendingMakeups } = require('../domain/cycles');
const {
    getRescheduleOptions, rescheduleLesson, getMakeupOptions, bookMakeup, moveLesson, cancelLessons, markAttendance,
} = require('../services/lessonService');
const { notifyCancellations, notifyMakeupBooked, notifyLessonMoved } = require('../services/noticeService');
const { buildCancellationReport } = require('../services/cancellationReportService');
const { pendingMakeupDeadline } = require('../domain/classRules');
const { classLabels } = require('../services/lessonLabels');

const include = [
    { model: User, as: 'student', attributes: ['id', 'name'] },
    { model: User, as: 'teacher', attributes: ['id', 'name'] },
    { model: Room, as: 'room', attributes: ['id', 'name'] },
    { model: Cycle, as: 'cycle', attributes: ['id', 'endDate', 'status'] },
    { model: User, as: 'substitute', attributes: ['id', 'name'] },
];

// Teachers and the academy do not see lessons of archived students
const includeFor = (user) => (user.role === 'student'
    ? include
    : [{ ...include[0], where: { active: true }, required: true }, ...include.slice(1)]);

const lessonJSON = (lesson) => {
    const { student, teacher, room, cycle, substitute, ...data } = lesson.get({ plain: true });
    return {
        ...data,
        studentName: student?.name,
        teacherName: teacher?.name,
        roomName: room?.name,
        cycleEndDate: cycle?.endDate,
        // Who gives it instead of teacherName, if anyone
        substituteLabel: substitute?.name || data.substituteName || null,
    };
};

// Whose lessons the user may list: a teacher's own and the ones they cover as substitute
const scopeFor = (user) => {
    if (user.role === 'teacher') return { [Op.or]: [{ teacherId: user.id }, { substituteTeacherId: user.id }] };
    if (user.role === 'student') return { studentId: user.id };
    return {};
};

// ?from=ISO&to=ISO&studentId=&status=a,b
router.get('/', auth, requireRole(), async (req, res) => {
    try {
        const where = { ...scopeFor(req.currentUser) };
        if (req.query.studentId && !where.studentId) where.studentId = req.query.studentId;
        if (req.query.status) where.status = String(req.query.status).split(',');
        if (req.query.from) where.startsAt = { ...(where.startsAt || {}), [Op.gte]: new Date(req.query.from) };
        if (req.query.to) where.startsAt = { ...(where.startsAt || {}), [Op.lt]: new Date(req.query.to) };
        const lessons = (await Lesson.findAll({ where, include: includeFor(req.currentUser), order: [['startsAt', 'ASC']] })).map(lessonJSON);
        const labelOf = await classLabels(lessons);
        res.json(lessons.map(l => ({ ...l, classLabel: labelOf.get(l.id) || null })));
    } catch (error) {
        handleError(res, error);
    }
});

// Lessons cancelled by the teacher or the academy still waiting for their make-up
router.get('/pending-makeups', auth, requireRole(), async (req, res) => {
    try {
        const scope = scopeFor(req.currentUser);
        const candidates = await Lesson.findAll({
            where: { ...scope, status: ['cancelada_por_profesor', 'cancelada_por_academia'] },
            attributes: ['id'],
        });
        if (!candidates.length) return res.json([]);
        const related = await Lesson.findAll({
            where: { [Op.or]: [{ id: candidates.map(c => c.id) }, { originalLessonId: candidates.map(c => c.id) }] },
        });
        const pendingIds = pendingMakeups(related.map(l => l.get({ plain: true }))).map(l => l.id);
        const lessons = await Lesson.findAll({ where: { id: pendingIds }, include: includeFor(req.currentUser), order: [['startsAt', 'ASC']] });
        // Last day the make-up can be given
        res.json(lessons.map(l => ({ ...lessonJSON(l), makeupDeadline: pendingMakeupDeadline(l) })));
    } catch (error) {
        handleError(res, error);
    }
});

// Register of the classes each teacher cancelled (academy): ?month=YYYY-MM&teacherId=
router.get('/cancellations', auth, requireRole('academy'), async (req, res) => {
    try {
        res.json(await buildCancellationReport({ month: req.query.month, teacherId: req.query.teacherId || null }));
    } catch (error) {
        handleError(res, error);
    }
});

// { lessonIds: [], reason? }
router.post('/cancel', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        const cancelled = await cancelLessons({ lessonIds: req.body.lessonIds, actor: req.currentUser, reason: req.body.reason || null });
        await notifyCancellations(cancelled, req.currentUser);
        res.json(cancelled);
    } catch (error) {
        handleError(res, error);
    }
});

// Teacher moves an upcoming lesson: { startsAt, roomId? }
router.post('/:id/move', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        const result = await moveLesson({ lessonId: req.params.id, actor: req.currentUser, roomId: req.body.roomId, startsAt: req.body.startsAt });
        await notifyLessonMoved({ ...result, actor: req.currentUser });
        res.json(result);
    } catch (error) {
        handleError(res, error);
    }
});

// { status: 'tomada' | 'perdida' }
router.post('/:id/attendance', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        res.json(await markAttendance({ lessonId: req.params.id, actor: req.currentUser, status: req.body.status }));
    } catch (error) {
        handleError(res, error);
    }
});

router.get('/:id/reschedule-options', auth, requireRole(), async (req, res) => {
    try {
        res.json(await getRescheduleOptions({ lessonId: req.params.id, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// { availabilityId, startsAt }
router.post('/:id/reschedule', auth, requireRole(), async (req, res) => {
    try {
        const result = await rescheduleLesson({ lessonId: req.params.id, actor: req.currentUser, ...req.body });
        await notifyMakeupBooked({ ...result, actor: req.currentUser, rescheduled: true });
        res.json(result);
    } catch (error) {
        handleError(res, error);
    }
});

router.get('/:id/makeup-options', auth, requireRole(), async (req, res) => {
    try {
        res.json(await getMakeupOptions({ lessonId: req.params.id, actor: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

// { availabilityId, startsAt } (student) or { roomId, startsAt } (teacher/academy, any free time)
router.post('/:id/makeup', auth, requireRole(), async (req, res) => {
    try {
        const result = await bookMakeup({ lessonId: req.params.id, actor: req.currentUser, ...req.body });
        await notifyMakeupBooked({ ...result, actor: req.currentUser, rescheduled: false });
        res.json(result);
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
