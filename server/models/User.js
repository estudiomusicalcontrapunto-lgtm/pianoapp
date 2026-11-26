const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');
const { currentStreak } = require('../domain/practice');
const { localDate } = require('../domain/time');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    role: {
        type: DataTypes.ENUM('student', 'teacher', 'academy'),
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    classCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    teacherId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    streak: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    level: {
        type: DataTypes.STRING,
        defaultValue: "Inicial"
    },
    // Students study one instrument; teachers use TeacherInstruments
    instrumentId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    xp: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    lastPractice: {
        type: DataTypes.STRING, // YYYY-MM-DD, America/Bogota (the full history is in PracticeDays)
        allowNull: true
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    birthDate: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    // Guardian contact only; the parent uses the student's account
    guardianName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    guardianPhone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    mustChangePassword: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // Students and teachers belong to a city; the academy account to none
    cityId: {
        type: DataTypes.UUID,
        allowNull: true
    }
    // (Users.paymentText still exists in the database but is not used: the academy
    // collects every payment, with the city's payment text.)
}, {
    hooks: {
        beforeSave: async (user) => {
            if (user.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(user.password, salt);
            }
        }
    }
});

// Instance method to compare password
User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Exclude password from JSON output. The streak is the current one: it drops to 0
// once a whole day goes by without practice (see domain/practice.js).
User.prototype.toJSON = function () {
    const values = Object.assign({}, this.get());
    delete values.password;
    if ('streak' in values) values.streak = currentStreak(values, localDate(new Date()));
    return values;
};

module.exports = User;
