// Cities ("sedes"), monthly billing and terms and conditions.
// - Cities: every student, teacher and room belongs to one. Each city has its
//   monthly fee, its single-class fee (empty = monthly fee / 4) and its payment text.
//   Only the academy sets fees, per city. A teacher may have their own payment
//   text, used only if the academy turns it on (see domain/pricing.js).
//   Existing users and rooms go to Pereira. Room names are unique per city.
// - Payments: one row per charge (mensualidad, proporcional, clase suelta), with
//   its receipts and the adjustments that correct it. A payment is never edited
//   or deleted: a correction is a new adjustment.
// - Terms: each published version is kept; acceptances record who accepted which
//   version and when.
const crypto = require('crypto');
const { DataTypes } = require('sequelize');

const ref = (model, allowNull = false) => ({
    type: DataTypes.UUID,
    allowNull,
    references: { model, key: 'id' },
});

const timestamps = {
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
};

const USER_COLUMNS = {
    cityId: ref('Cities', true),
    // Teacher's own payment text, used only if the academy turns it on; empty = the city's
    paymentText: { type: DataTypes.TEXT, allowNull: true },
};

const DEFAULT_PAYMENT_TEXT = 'Escribe aquí la cuenta bancaria, el número de Nequi y las instrucciones para pagar.';

// Room.name was unique for the whole academy; now it is unique per city
const dropGlobalRoomNameUnique = async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'sqlite') {
        // SQLite cannot drop a column constraint: changeColumn rebuilds the table.
        // Foreign keys are off meanwhile so dropping the old table does not touch the rows that point to it.
        await queryInterface.sequelize.query('PRAGMA foreign_keys = OFF');
        try {
            await queryInterface.changeColumn('Rooms', 'name', { type: DataTypes.STRING, allowNull: false, unique: false });
        } finally {
            await queryInterface.sequelize.query('PRAGMA foreign_keys = ON');
        }
        return;
    }
    const indexes = await queryInterface.showIndex('Rooms');
    for (const index of indexes) {
        const fields = (index.fields || []).map(f => f.attribute);
        if (index.unique && !index.primary && fields.length === 1 && fields[0] === 'name') {
            await queryInterface.removeIndex('Rooms', index.name);
        }
    }
};

exports.up = async ({ context: queryInterface }) => {
    await queryInterface.createTable('Cities', {
        id: { type: DataTypes.UUID, primaryKey: true },
        name: { type: DataTypes.STRING, allowNull: false, unique: true },
        monthlyFee: { type: DataTypes.INTEGER, allowNull: false },
        singleClassFee: { type: DataTypes.INTEGER, allowNull: true },
        paymentText: { type: DataTypes.TEXT, allowNull: true },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ...timestamps,
    });

    const now = new Date();
    const pereiraId = crypto.randomUUID();
    await queryInterface.bulkInsert('Cities', [{
        id: pereiraId, name: 'Pereira', monthlyFee: 260000, singleClassFee: null,
        paymentText: DEFAULT_PAYMENT_TEXT, active: true, createdAt: now, updatedAt: now,
    }]);

    const users = await queryInterface.describeTable('Users');
    for (const [name, definition] of Object.entries(USER_COLUMNS)) {
        if (!users[name]) await queryInterface.addColumn('Users', name, definition);
    }
    await queryInterface.sequelize.query(
        "UPDATE Users SET cityId = :pereiraId WHERE role IN ('student', 'teacher') AND cityId IS NULL",
        { replacements: { pereiraId } }
    );

    await dropGlobalRoomNameUnique(queryInterface);
    const rooms = await queryInterface.describeTable('Rooms');
    if (!rooms.cityId) await queryInterface.addColumn('Rooms', 'cityId', ref('Cities', true));
    await queryInterface.sequelize.query('UPDATE Rooms SET cityId = :pereiraId WHERE cityId IS NULL', { replacements: { pereiraId } });
    await queryInterface.addIndex('Rooms', ['cityId', 'name'], { unique: true, name: 'rooms_city_name' });

    await queryInterface.createTable('Payments', {
        id: { type: DataTypes.UUID, primaryKey: true },
        studentId: ref('Users'),
        cityId: ref('Cities'),
        teacherId: ref('Users', true),
        type: { type: DataTypes.ENUM('mensualidad', 'proporcional', 'clase_suelta'), allowNull: false },
        // 'YYYY-MM' for mensualidad and proporcional
        period: { type: DataTypes.STRING(7), allowNull: true },
        // The class a clase suelta pays for
        lessonId: ref('Lessons', true),
        amount: { type: DataTypes.INTEGER, allowNull: false },
        // How the amount was calculated (fees used, classes counted, discounts)
        calculation: { type: DataTypes.JSON, allowNull: true },
        dueDate: { type: DataTypes.DATEONLY, allowNull: true },
        status: {
            type: DataTypes.ENUM('por_pagar', 'en_revision', 'aprobado', 'rechazado', 'anulado'),
            allowNull: false,
            defaultValue: 'por_pagar',
        },
        rejectionReason: { type: DataTypes.TEXT, allowNull: true },
        reviewedById: ref('Users', true),
        reviewedAt: { type: DataTypes.DATE, allowNull: true },
        createdById: ref('Users', true),
        ...timestamps,
    });
    await queryInterface.addIndex('Payments', ['studentId', 'period'], { name: 'payments_student_period' });
    await queryInterface.addIndex('Payments', ['status'], { name: 'payments_status' });

    await queryInterface.createTable('PaymentReceipts', {
        id: { type: DataTypes.UUID, primaryKey: true },
        paymentId: ref('Payments'),
        path: { type: DataTypes.STRING, allowNull: false },
        originalName: { type: DataTypes.STRING, allowNull: true },
        mimeType: { type: DataTypes.STRING, allowNull: true },
        uploadedById: ref('Users', true),
        status: { type: DataTypes.ENUM('en_revision', 'aprobado', 'rechazado'), allowNull: false, defaultValue: 'en_revision' },
        rejectionReason: { type: DataTypes.TEXT, allowNull: true },
        reviewedById: ref('Users', true),
        reviewedAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps,
    });
    await queryInterface.addIndex('PaymentReceipts', ['paymentId'], { name: 'payment_receipts_payment' });

    await queryInterface.createTable('PaymentAdjustments', {
        id: { type: DataTypes.UUID, primaryKey: true },
        studentId: ref('Users'),
        // The payment this corrects, if any
        paymentId: ref('Payments', true),
        // The payment it was applied to (e.g. a discount on the next mensualidad)
        appliedPaymentId: ref('Payments', true),
        lessonId: ref('Lessons', true),
        kind: { type: DataTypes.ENUM('correccion', 'descuento_clase_no_repuesta'), allowNull: false },
        // Signed COP: negative lowers what the student owes
        amount: { type: DataTypes.INTEGER, allowNull: false },
        reason: { type: DataTypes.TEXT, allowNull: false },
        createdById: ref('Users', true),
        createdAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('PaymentAdjustments', ['studentId'], { name: 'payment_adjustments_student' });

    await queryInterface.createTable('TermsVersions', {
        id: { type: DataTypes.UUID, primaryKey: true },
        version: { type: DataTypes.INTEGER, allowNull: false, unique: true },
        content: { type: DataTypes.TEXT, allowNull: false },
        // Students who already use the app must accept it by this day
        acceptBy: { type: DataTypes.DATEONLY, allowNull: true },
        publishedById: ref('Users', true),
        createdAt: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.createTable('TermsAcceptances', {
        id: { type: DataTypes.UUID, primaryKey: true },
        userId: ref('Users'),
        termsVersionId: ref('TermsVersions'),
        version: { type: DataTypes.INTEGER, allowNull: false },
        acceptedAt: { type: DataTypes.DATE, allowNull: false },
        ipAddress: { type: DataTypes.STRING, allowNull: true },
        userAgent: { type: DataTypes.STRING(500), allowNull: true },
    });
    await queryInterface.addIndex('TermsAcceptances', ['userId', 'termsVersionId'], { unique: true, name: 'terms_acceptances_unique' });
};

exports.down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable('TermsAcceptances');
    await queryInterface.dropTable('TermsVersions');
    await queryInterface.dropTable('PaymentAdjustments');
    await queryInterface.dropTable('PaymentReceipts');
    await queryInterface.dropTable('Payments');
    await queryInterface.removeIndex('Rooms', 'rooms_city_name');
    await queryInterface.removeColumn('Rooms', 'cityId');
    for (const name of Object.keys(USER_COLUMNS).reverse()) {
        await queryInterface.removeColumn('Users', name);
    }
    await queryInterface.dropTable('Cities');
};
