const express = require('express');
const router = express.Router();
const { sequelize, Room, User, TeacherRoom, City, Lesson, FixedSchedule, Availability, Assessment } = require('../models');
const { assertActiveCity, defaultCityId, assertTeachersInRoomCity, assertRoomNameFree } = require('../services/cityService');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const handleError = require('./handleError');
const { logAudit } = require('../services/audit');
const { buildRoomWeek } = require('../services/calendarService');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const roomJSON = (room) => ({
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    active: room.active,
    cityId: room.cityId,
    cityName: room.city?.name || null,
    teachers: (room.teachers || []).map(t => ({ id: t.id, name: t.name })),
});

// The academy sees every room; a teacher only the rooms assigned to them
router.get('/', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        const include = [
            { model: User, as: 'teachers', attributes: ['id', 'name'], through: { attributes: [] } },
            { model: City, as: 'city', attributes: ['id', 'name'] },
        ];
        let rooms = await Room.findAll({ include, order: [['name', 'ASC']] });
        if (req.currentUser.role === 'teacher') {
            rooms = rooms.filter(r => r.active && r.teachers.some(t => t.id === req.currentUser.id));
        }
        res.json(rooms.map(roomJSON));
    } catch (error) {
        handleError(res, error);
    }
});

const validateRoom = async ({ name, capacity, cityId }, excludeId) => {
    if (name !== undefined) {
        if (!name || !name.trim()) return 'El nombre del salón es obligatorio.';
        await assertRoomNameFree({ name: name.trim(), cityId, excludeId });
    }
    if (capacity !== undefined && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)) {
        return 'La capacidad debe ser un número mayor que 0.';
    }
    return null;
};

router.post('/', auth, requireRole('academy'), async (req, res) => {
    try {
        const cityId = req.body.cityId ? (await assertActiveCity(req.body.cityId)).id : await defaultCityId();
        const message = await validateRoom({ name: req.body.name ?? '', capacity: req.body.capacity, cityId });
        if (message) return res.status(400).json({ message });
        const room = await Room.create({ name: req.body.name.trim(), capacity: Number(req.body.capacity) || 1, cityId });
        await logAudit({ entityType: 'room', entityId: room.id, action: 'crear', actorId: req.currentUser.id });
        res.status(201).json(roomJSON(room));
    } catch (error) {
        handleError(res, error);
    }
});

router.put('/:id', auth, requireRole('academy'), async (req, res) => {
    try {
        const room = await Room.findByPk(req.params.id);
        if (!room) return res.status(404).json({ message: 'Salón no encontrado' });
        const { name, capacity, active } = req.body;
        const message = await validateRoom({ name, capacity, cityId: room.cityId }, room.id);
        if (message) return res.status(400).json({ message });
        await room.update({
            ...(name !== undefined && { name: name.trim() }),
            ...(capacity !== undefined && { capacity: Number(capacity) }),
            ...(active !== undefined && { active: !!active }),
        });
        res.json(roomJSON(room));
    } catch (error) {
        handleError(res, error);
    }
});

// Deletes a room nobody used: no classes (past or future), weekly times, open make-up
// windows or held slots. Otherwise it can only be deactivated, so history keeps its room.
router.delete('/:id', auth, requireRole('academy'), async (req, res) => {
    try {
        const room = await Room.findByPk(req.params.id);
        if (!room) return res.status(404).json({ message: 'Salón no encontrado' });
        const [lessons, fixed, windows, holds] = await Promise.all([
            Lesson.count({ where: { roomId: room.id } }),
            FixedSchedule.count({ where: { roomId: room.id } }),
            Availability.count({ where: { roomId: room.id, active: true } }),
            Assessment.count({ where: { holdRoomId: room.id } }),
        ]);
        const uses = [
            lessons && `${lessons} clase(s)`,
            fixed && `${fixed} horario(s) semanal(es)`,
            windows && `${windows} franja(s) de reposición`,
            holds && `${holds} cupo(s) de valoración`,
        ].filter(Boolean);
        if (uses.length) {
            return res.status(409).json({ message: `No puedes eliminar ${room.name} porque tiene ${uses.join(', ')}. Si ya no lo usas, desactívalo.` });
        }
        await sequelize.transaction(async (transaction) => {
            await TeacherRoom.destroy({ where: { roomId: room.id }, transaction });
            await Availability.destroy({ where: { roomId: room.id }, transaction });
            await room.destroy({ transaction });
            await logAudit({ entityType: 'room', entityId: room.id, action: 'eliminar', actorId: req.currentUser.id, details: { name: room.name } }, { transaction });
        });
        res.json({ message: 'Salón eliminado' });
    } catch (error) {
        handleError(res, error);
    }
});

// Replaces the teachers assigned to a room
router.put('/:id/teachers', auth, requireRole('academy'), async (req, res) => {
    try {
        const room = await Room.findByPk(req.params.id);
        if (!room) return res.status(404).json({ message: 'Salón no encontrado' });
        const teacherIds = [...new Set(req.body.teacherIds || [])];
        const teachers = await User.findAll({ where: { id: teacherIds, role: 'teacher' } });
        if (teachers.length !== teacherIds.length) return res.status(400).json({ message: 'Algún profesor no existe.' });
        await assertTeachersInRoomCity(room, teachers);

        await sequelize.transaction(async (transaction) => {
            await TeacherRoom.destroy({ where: { roomId: room.id }, transaction });
            for (const teacherId of teacherIds) {
                await TeacherRoom.create({ roomId: room.id, teacherId }, { transaction });
            }
            await logAudit({
                entityType: 'room', entityId: room.id, action: 'asignar_profesores', actorId: req.currentUser.id, details: { teacherIds },
            }, { transaction });
        });
        res.json({ id: room.id, teachers: teachers.map(t => ({ id: t.id, name: t.name })) });
    } catch (error) {
        handleError(res, error);
    }
});

// Weekly calendar of a room. ?date=YYYY-MM-DD picks the week (default: this week)
router.get('/:id/week', auth, requireRole('academy', 'teacher'), async (req, res) => {
    try {
        const date = DATE_PATTERN.test(req.query.date || '') ? req.query.date : undefined;
        res.json(await buildRoomWeek({ roomId: req.params.id, date, viewer: req.currentUser }));
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
