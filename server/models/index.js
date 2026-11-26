const sequelize = require('../config/database');
const User = require('./User');
const Repertoire = require('./Repertoire');
const { Announcement, AnnouncementRead } = require('./Announcement');
const Room = require('./Room');
const TeacherRoom = require('./TeacherRoom');
const Availability = require('./Availability');
const FixedSchedule = require('./FixedSchedule');
const Cycle = require('./Cycle');
const Lesson = require('./Lesson');
const Assessment = require('./Assessment');
const { Notice, NoticeRecipient } = require('./Notice');
const Setting = require('./Setting');
const ClosureDay = require('./ClosureDay');
const AuditLog = require('./AuditLog');
const LevelRequest = require('./LevelRequest');
const Instrument = require('./Instrument');
const TeacherInstrument = require('./TeacherInstrument');
const { LevelRequirement, LevelResource } = require('./LevelGuide');
const TeacherAbsence = require('./TeacherAbsence');
const InstrumentLevel = require('./InstrumentLevel');
const PracticeDay = require('./PracticeDay');
const City = require('./City');
const Payment = require('./Payment');
const PaymentReceipt = require('./PaymentReceipt');
const PaymentAdjustment = require('./PaymentAdjustment');
const { TermsVersion, TermsAcceptance } = require('./Terms');
const { STANDARD_LEVELS } = require('../domain/levels');

// Define Relationships

// A User (Teacher) can have many Users (Students)
User.hasMany(User, { as: 'Students', foreignKey: 'teacherId' });
User.belongsTo(User, { as: 'Teacher', foreignKey: 'teacherId' });

// A User (Student) has many Repertoires
User.hasMany(Repertoire, { as: 'repertoire', foreignKey: 'studentId' });
Repertoire.belongsTo(User, { foreignKey: 'studentId' });

// Announcements: teacherId is whoever published it (teacher or academy)
User.hasMany(Announcement, { foreignKey: 'teacherId' });
Announcement.belongsTo(User, { foreignKey: 'teacherId' });
Announcement.hasMany(AnnouncementRead, { as: 'reads', foreignKey: 'announcementId' });

// Rooms are shared between teachers
User.belongsToMany(Room, { through: TeacherRoom, as: 'rooms', foreignKey: 'teacherId', otherKey: 'roomId' });
Room.belongsToMany(User, { through: TeacherRoom, as: 'teachers', foreignKey: 'roomId', otherKey: 'teacherId' });

// Teacher availability and students' fixed schedules
Availability.belongsTo(User, { as: 'teacher', foreignKey: 'teacherId' });
Availability.belongsTo(Room, { as: 'room', foreignKey: 'roomId' });
FixedSchedule.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
FixedSchedule.belongsTo(User, { as: 'teacher', foreignKey: 'teacherId' });
FixedSchedule.belongsTo(Room, { as: 'room', foreignKey: 'roomId' });

// Cycles and their lessons
User.hasMany(Cycle, { as: 'cycles', foreignKey: 'studentId' });
Cycle.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
Cycle.belongsTo(User, { as: 'confirmedBy', foreignKey: 'confirmedById' });
Cycle.hasMany(Lesson, { as: 'lessons', foreignKey: 'cycleId' });
Lesson.belongsTo(Cycle, { as: 'cycle', foreignKey: 'cycleId' });
Lesson.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
Lesson.belongsTo(User, { as: 'teacher', foreignKey: 'teacherId' });
Lesson.belongsTo(Room, { as: 'room', foreignKey: 'roomId' });
Lesson.belongsTo(Lesson, { as: 'originalLesson', foreignKey: 'originalLessonId' });
Lesson.hasMany(Lesson, { as: 'makeups', foreignKey: 'originalLessonId' });
Lesson.belongsTo(User, { as: 'substitute', foreignKey: 'substituteTeacherId' });

// Teacher absences
TeacherAbsence.belongsTo(User, { as: 'teacher', foreignKey: 'teacherId' });

// Assessments
Assessment.belongsTo(User, { as: 'teacher', foreignKey: 'teacherId' });
Assessment.belongsTo(Room, { as: 'holdRoom', foreignKey: 'holdRoomId' });
Assessment.belongsTo(User, { as: 'convertedStudent', foreignKey: 'convertedStudentId' });

// Notices
Notice.hasMany(NoticeRecipient, { as: 'recipients', foreignKey: 'noticeId' });
NoticeRecipient.belongsTo(Notice, { as: 'notice', foreignKey: 'noticeId' });
NoticeRecipient.belongsTo(User, { as: 'user', foreignKey: 'userId' });

// Level-up requests
LevelRequest.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
LevelRequest.belongsTo(User, { as: 'teacher', foreignKey: 'teacherId' });

// Instruments: one per student, several per teacher
User.belongsTo(Instrument, { as: 'instrument', foreignKey: 'instrumentId' });
User.belongsToMany(Instrument, { through: TeacherInstrument, as: 'instruments', foreignKey: 'teacherId', otherKey: 'instrumentId' });
Instrument.belongsToMany(User, { through: TeacherInstrument, as: 'teachers', foreignKey: 'instrumentId', otherKey: 'teacherId' });
Instrument.hasMany(InstrumentLevel, { as: 'levels', foreignKey: 'instrumentId' });

// Cities: students, teachers and rooms belong to one
User.belongsTo(City, { as: 'city', foreignKey: 'cityId' });
Room.belongsTo(City, { as: 'city', foreignKey: 'cityId' });

// Payments, their receipts and the adjustments that correct them
Payment.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
Payment.belongsTo(User, { as: 'teacher', foreignKey: 'teacherId' });
Payment.belongsTo(City, { as: 'city', foreignKey: 'cityId' });
Payment.belongsTo(Lesson, { as: 'lesson', foreignKey: 'lessonId' });
Payment.hasMany(PaymentReceipt, { as: 'receipts', foreignKey: 'paymentId' });
PaymentReceipt.belongsTo(Payment, { as: 'payment', foreignKey: 'paymentId' });
Payment.hasMany(PaymentAdjustment, { as: 'adjustments', foreignKey: 'paymentId' });
Payment.hasMany(PaymentAdjustment, { as: 'appliedAdjustments', foreignKey: 'appliedPaymentId' });
PaymentAdjustment.belongsTo(User, { as: 'student', foreignKey: 'studentId' });

// Terms and conditions
TermsVersion.hasMany(TermsAcceptance, { as: 'acceptances', foreignKey: 'termsVersionId' });
TermsAcceptance.belongsTo(TermsVersion, { as: 'termsVersion', foreignKey: 'termsVersionId' });
TermsAcceptance.belongsTo(User, { as: 'user', foreignKey: 'userId' });

// Every new instrument starts with the standard ladder; the academy adjusts it in "Grados"
Instrument.afterCreate((instrument, options) =>
    InstrumentLevel.bulkCreate(
        STANDARD_LEVELS.map((name, position) => ({ instrumentId: instrument.id, name, position })),
        { transaction: options.transaction }
    ));

module.exports = {
    sequelize,
    User,
    Repertoire,
    Announcement,
    AnnouncementRead,
    Room,
    TeacherRoom,
    Availability,
    FixedSchedule,
    Cycle,
    Lesson,
    Assessment,
    Notice,
    NoticeRecipient,
    Setting,
    ClosureDay,
    AuditLog,
    LevelRequest,
    Instrument,
    TeacherInstrument,
    LevelRequirement,
    LevelResource,
    TeacherAbsence,
    InstrumentLevel,
    PracticeDay,
    City,
    Payment,
    PaymentReceipt,
    PaymentAdjustment,
    TermsVersion,
    TermsAcceptance
};
