// Rooms, availability, fixed schedules, cycles, lessons, assessments, notices,
// settings, closure days and the audit log.
// Enum values are written out here (not imported) so this migration never changes.
const { DataTypes } = require('sequelize');

const id = { type: DataTypes.UUID, primaryKey: true };
const ref = (model, allowNull = false) => ({
    type: DataTypes.UUID,
    allowNull,
    references: { model, key: 'id' },
});
const timestamps = {
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
};

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('Rooms', {
        id,
        name: { type: DataTypes.STRING, allowNull: false, unique: true },
        capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ...timestamps,
    });

    await queryInterface.createTable('TeacherRooms', {
        id,
        teacherId: ref('Users'),
        roomId: ref('Rooms'),
        ...timestamps,
    });
    await queryInterface.addIndex('TeacherRooms', ['teacherId', 'roomId'], { unique: true, name: 'teacher_rooms_unique' });

    // Weekly windows. weekday: 1 = lunes ... 6 = sábado. Times are 'HH:mm' in America/Bogota.
    await queryInterface.createTable('Availabilities', {
        id,
        teacherId: ref('Users'),
        roomId: ref('Rooms'),
        weekday: { type: DataTypes.INTEGER, allowNull: false },
        startTime: { type: DataTypes.STRING(5), allowNull: false },
        endTime: { type: DataTypes.STRING(5), allowNull: false },
        type: { type: DataTypes.ENUM('clase', 'reposicion'), allowNull: false },
        capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ...timestamps,
    });
    await queryInterface.addIndex('Availabilities', ['roomId', 'weekday'], { name: 'availabilities_room_weekday' });
    await queryInterface.addIndex('Availabilities', ['teacherId'], { name: 'availabilities_teacher' });

    await queryInterface.createTable('FixedSchedules', {
        id,
        studentId: ref('Users'),
        teacherId: ref('Users'),
        roomId: ref('Rooms'),
        weekday: { type: DataTypes.INTEGER, allowNull: false },
        startTime: { type: DataTypes.STRING(5), allowNull: false },
        durationMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
        validFrom: { type: DataTypes.DATEONLY, allowNull: false },
        validTo: { type: DataTypes.DATEONLY, allowNull: true },
        ...timestamps,
    });
    await queryInterface.addIndex('FixedSchedules', ['roomId', 'weekday'], { name: 'fixed_schedules_room_weekday' });
    await queryInterface.addIndex('FixedSchedules', ['studentId'], { name: 'fixed_schedules_student' });

    await queryInterface.createTable('Cycles', {
        id,
        studentId: ref('Users'),
        startDate: { type: DataTypes.DATEONLY, allowNull: false },
        endDate: { type: DataTypes.DATEONLY, allowNull: false },
        plan: { type: DataTypes.ENUM('paquete_4', 'suelta'), allowNull: false },
        classesIncluded: { type: DataTypes.INTEGER, allowNull: false },
        amount: { type: DataTypes.INTEGER, allowNull: false }, // COP, whole pesos
        paymentStatus: {
            type: DataTypes.ENUM('pendiente', 'en_revision', 'pagado', 'vencido'),
            allowNull: false,
            defaultValue: 'pendiente',
        },
        status: {
            type: DataTypes.ENUM('pendiente_pago', 'activo', 'finalizado', 'cancelado'),
            allowNull: false,
            defaultValue: 'pendiente_pago',
        },
        receiptPath: { type: DataTypes.STRING, allowNull: true },
        receiptUploadedAt: { type: DataTypes.DATE, allowNull: true },
        confirmedById: ref('Users', true),
        confirmedAt: { type: DataTypes.DATE, allowNull: true },
        rejectionReason: { type: DataTypes.TEXT, allowNull: true },
        ...timestamps,
    });
    await queryInterface.addIndex('Cycles', ['studentId'], { name: 'cycles_student' });
    await queryInterface.addIndex('Cycles', ['paymentStatus'], { name: 'cycles_payment_status' });

    await queryInterface.createTable('Lessons', {
        id,
        cycleId: ref('Cycles'),
        studentId: ref('Users'),
        teacherId: ref('Users'),
        roomId: ref('Rooms'),
        startsAt: { type: DataTypes.DATE, allowNull: false }, // UTC
        endsAt: { type: DataTypes.DATE, allowNull: false },
        status: {
            type: DataTypes.ENUM(
                'programada',
                'tomada',
                'perdida',
                'reprogramada_por_estudiante',
                'cancelada_por_profesor',
                'cancelada_por_academia'
            ),
            allowNull: false,
            defaultValue: 'programada',
        },
        kind: { type: DataTypes.ENUM('regular', 'reposicion'), allowNull: false, defaultValue: 'regular' },
        originalLessonId: ref('Lessons', true),
        availabilityId: ref('Availabilities', true),
        changedById: ref('Users', true),
        changedAt: { type: DataTypes.DATE, allowNull: true },
        reason: { type: DataTypes.TEXT, allowNull: true },
        ...timestamps,
    });
    await queryInterface.addIndex('Lessons', ['roomId', 'startsAt'], { name: 'lessons_room_start' });
    await queryInterface.addIndex('Lessons', ['teacherId', 'startsAt'], { name: 'lessons_teacher_start' });
    await queryInterface.addIndex('Lessons', ['studentId', 'startsAt'], { name: 'lessons_student_start' });
    await queryInterface.addIndex('Lessons', ['cycleId'], { name: 'lessons_cycle' });
    await queryInterface.addIndex('Lessons', ['originalLessonId'], { name: 'lessons_original' });

    // Free assessment ("valoración") and the weekly slot held for it until holdExpiresAt
    await queryInterface.createTable('Assessments', {
        id,
        studentName: { type: DataTypes.STRING, allowNull: false },
        studentBirthDate: { type: DataTypes.DATEONLY, allowNull: true },
        contactName: { type: DataTypes.STRING, allowNull: true },
        contactPhone: { type: DataTypes.STRING, allowNull: true },
        contactEmail: { type: DataTypes.STRING, allowNull: true },
        scheduledAt: { type: DataTypes.DATE, allowNull: false },
        teacherId: ref('Users'),
        status: {
            type: DataTypes.ENUM('agendada', 'realizada', 'convertida', 'descartada'),
            allowNull: false,
            defaultValue: 'agendada',
        },
        result: { type: DataTypes.TEXT, allowNull: true },
        holdRoomId: ref('Rooms', true),
        holdWeekday: { type: DataTypes.INTEGER, allowNull: true },
        holdStartTime: { type: DataTypes.STRING(5), allowNull: true },
        holdDurationMinutes: { type: DataTypes.INTEGER, allowNull: true },
        holdExpiresAt: { type: DataTypes.DATE, allowNull: true },
        holdStatus: {
            type: DataTypes.ENUM('sin_apartar', 'apartado', 'liberado', 'convertido'),
            allowNull: false,
            defaultValue: 'sin_apartar',
        },
        convertedStudentId: ref('Users', true),
        ...timestamps,
    });
    await queryInterface.addIndex('Assessments', ['holdStatus', 'holdExpiresAt'], { name: 'assessments_hold' });

    await queryInterface.createTable('Notices', {
        id,
        kind: { type: DataTypes.ENUM('sistema', 'manual'), allowNull: false },
        category: { type: DataTypes.STRING, allowNull: true },
        title: { type: DataTypes.STRING, allowNull: false },
        message: { type: DataTypes.TEXT, allowNull: false },
        authorId: ref('Users', true),
        meta: { type: DataTypes.JSON, allowNull: true },
        ...timestamps,
    });

    await queryInterface.createTable('NoticeRecipients', {
        id,
        noticeId: ref('Notices'),
        userId: ref('Users'),
        readAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps,
    });
    await queryInterface.addIndex('NoticeRecipients', ['noticeId', 'userId'], { unique: true, name: 'notice_recipients_unique' });
    await queryInterface.addIndex('NoticeRecipients', ['userId'], { name: 'notice_recipients_user' });

    // One row per rule; value is JSON-encoded text
    await queryInterface.createTable('Settings', {
        key: { type: DataTypes.STRING, primaryKey: true },
        value: { type: DataTypes.TEXT, allowNull: false },
        ...timestamps,
    });

    await queryInterface.createTable('ClosureDays', {
        id,
        date: { type: DataTypes.DATEONLY, allowNull: false, unique: true },
        reason: { type: DataTypes.STRING, allowNull: false },
        appliedAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps,
    });

    await queryInterface.createTable('AuditLogs', {
        id,
        entityType: { type: DataTypes.STRING, allowNull: false },
        entityId: { type: DataTypes.STRING, allowNull: false },
        action: { type: DataTypes.STRING, allowNull: false },
        fromStatus: { type: DataTypes.STRING, allowNull: true },
        toStatus: { type: DataTypes.STRING, allowNull: true },
        actorId: ref('Users', true),
        details: { type: DataTypes.JSON, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('AuditLogs', ['entityType', 'entityId'], { name: 'audit_logs_entity' });
};

exports.down = async ({ context: queryInterface }) => {
    for (const table of [
        'AuditLogs', 'ClosureDays', 'Settings', 'NoticeRecipients', 'Notices', 'Assessments',
        'Lessons', 'Cycles', 'FixedSchedules', 'Availabilities', 'TeacherRooms', 'Rooms',
    ]) {
        await queryInterface.dropTable(table);
    }
};
