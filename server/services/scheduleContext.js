// Loads what is already booked around some rooms, teachers and students, in
// the shape the domain conflict checks expect.
const { Op } = require('sequelize');
const { Lesson, FixedSchedule, Availability, Assessment, ClosureDay, Room, TeacherAbsence } = require('../models');
const { User } = require('../models');
const { HOLD_STATUS, ROLES } = require('../domain/constants');
const { localDate } = require('../domain/time');
const { getSettings } = require('./settingsService');

const plain = (rows) => rows.map(r => r.get({ plain: true }));
const ids = (list) => [...new Set((list || []).filter(Boolean))];

/**
 * scope: { roomIds, teacherIds, studentIds, from: Date, to: Date }
 * Returns { lessons, fixedSchedules, availabilities, holds, closures, absences, roomNames, now }.
 */
const loadScheduleContext = async (scope, { transaction, now }) => {
    const roomIds = ids(scope.roomIds);
    const teacherIds = ids(scope.teacherIds);
    const studentIds = ids(scope.studentIds);
    const anyOf = (fields) => fields.filter(([, list]) => list.length).map(([field, list]) => ({ [field]: list }));

    const lessonOwners = anyOf([['roomId', roomIds], ['teacherId', teacherIds], ['studentId', studentIds]]);
    // A substitute's lessons are theirs too while they cover them
    const lessonTakers = [...lessonOwners, ...anyOf([['substituteTeacherId', teacherIds]])];
    const lessons = lessonOwners.length
        ? await Lesson.findAll({
            where: {
                [Op.or]: lessonTakers,
                startsAt: { [Op.lt]: scope.to },
                endsAt: { [Op.gt]: scope.from },
            },
            transaction,
        })
        : [];

    const fixedSchedules = lessonOwners.length
        ? await FixedSchedule.findAll({ where: { [Op.or]: lessonOwners }, transaction })
        : [];

    const windowOwners = anyOf([['roomId', roomIds], ['teacherId', teacherIds]]);
    const availabilities = windowOwners.length
        ? await Availability.findAll({ where: { active: true, [Op.or]: windowOwners }, transaction })
        : [];

    const holdOwners = anyOf([['holdRoomId', roomIds], ['teacherId', teacherIds]]);
    const holds = holdOwners.length
        ? await Assessment.findAll({ where: { holdStatus: HOLD_STATUS.APARTADO, [Op.or]: holdOwners }, transaction })
        : [];

    const absences = teacherIds.length
        ? await TeacherAbsence.findAll({
            where: { teacherId: teacherIds, startDate: { [Op.lte]: localDate(scope.to) }, endDate: { [Op.gte]: localDate(scope.from) } },
            transaction,
        })
        : [];

    const closures = await ClosureDay.findAll({ transaction });
    const rooms = await Room.findAll({ attributes: ['id', 'name'], transaction });

    // Archived students hold no time: their lessons and schedules are ignored
    const archived = new Set((await User.findAll({
        where: { role: ROLES.STUDENT, active: false }, attributes: ['id'], transaction,
    })).map(u => u.id));
    const ofActiveStudent = (row) => !archived.has(row.studentId);

    // With the monthly fee covering 4 classes, the 5th week of each month has no fixed class
    const settings = await getSettings({ transaction });

    return {
        fifthWeekFree: !settings.mensualidad_cubre_todas_las_clases,
        lessons: plain(lessons).filter(ofActiveStudent),
        fixedSchedules: plain(fixedSchedules).filter(ofActiveStudent),
        availabilities: plain(availabilities),
        holds: plain(holds),
        closures: plain(closures),
        absences: plain(absences),
        roomNames: Object.fromEntries(rooms.map(r => [r.id, r.name])),
        now,
    };
};

module.exports = { loadScheduleContext };
