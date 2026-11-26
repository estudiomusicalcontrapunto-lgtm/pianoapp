// Accounts created by the academy. They start with a temporary password the
// academy hands over; the user is asked to change it on first login.
const crypto = require('crypto');
const { User, Instrument } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { levelLabel } = require('../domain/levels');
const { assertActiveInstrument, assertTeacherTeaches, defaultInstrumentId } = require('./instrumentService');
const { getLadder } = require('./levelLadderService');
const { resolveStudentCity } = require('./cityService');

// No look-alike characters (0/O, 1/l/I)
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const generateTempPassword = (length = 10) =>
    Array.from(crypto.randomBytes(length), byte => ALPHABET[byte % ALPHABET.length]).join('');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STUDENT_FIELDS = ['name', 'email', 'teacherId', 'instrumentId', 'birthDate', 'phone', 'guardianName', 'guardianPhone', 'level', 'active', 'cityId'];

const validateStudentData = async (data, { transaction, excludeId } = {}) => {
    if (data.name !== undefined && !String(data.name).trim()) {
        throw new DomainError('nombre_requerido', 'El nombre es obligatorio.');
    }
    if (data.email !== undefined) {
        if (!EMAIL_PATTERN.test(data.email || '')) throw new DomainError('email_invalido', 'El email no es válido.');
        const existing = await User.findOne({ where: { email: data.email }, transaction });
        if (existing && existing.id !== excludeId) throw new DomainError('email_repetido', 'El email ya está registrado.');
    }
    if (data.teacherId) {
        const teacher = await User.findByPk(data.teacherId, { transaction });
        if (!teacher || teacher.role !== ROLES.TEACHER) throw new DomainError('profesor_invalido', 'El profesor no existe.');
    }
    if (data.instrumentId) await assertActiveInstrument(data.instrumentId, { transaction });
};

// The level must be on the ladder of the student's instrument
const assertLevelOnLadder = async (level, instrumentId, { transaction } = {}) => {
    const ladder = await getLadder(instrumentId, { transaction });
    if (!ladder.includes(String(level))) {
        const instrument = instrumentId && await Instrument.findByPk(instrumentId, { attributes: ['name'], transaction });
        throw new DomainError('nivel_invalido', instrument
            ? `${levelLabel(level)} no es un nivel de ${instrument.name}. Elige uno de sus niveles.`
            : 'El nivel no es válido.');
    }
};

/** Creates a student account. Returns { student, tempPassword }. */
const createStudent = async (data, { transaction } = {}) => {
    if (!data.name || !String(data.name).trim()) throw new DomainError('nombre_requerido', 'El nombre es obligatorio.');
    if (!data.email) throw new DomainError('email_invalido', 'El email es obligatorio.');
    const attributes = Object.fromEntries(STUDENT_FIELDS.filter(f => data[f] !== undefined && data[f] !== '').map(f => [f, data[f]]));
    await validateStudentData(attributes, { transaction });
    const instrumentId = attributes.instrumentId || await defaultInstrumentId(attributes.teacherId, { transaction });
    await assertTeacherTeaches({ teacherId: attributes.teacherId, instrumentId }, { transaction });
    // Without a level, the student starts at the lowest level of their instrument
    const level = attributes.level ?? (await getLadder(instrumentId, { transaction }))[0];
    await assertLevelOnLadder(level, instrumentId, { transaction });
    // The student's city is their teacher's
    const cityId = await resolveStudentCity({ cityId: attributes.cityId, teacherId: attributes.teacherId }, { transaction });
    const tempPassword = generateTempPassword();
    const student = await User.create({
        ...attributes,
        cityId,
        instrumentId,
        level,
        email: data.email.trim().toLowerCase(),
        name: data.name.trim(),
        role: ROLES.STUDENT,
        password: tempPassword,
        mustChangePassword: true,
    }, { transaction });
    return { student, tempPassword };
};

/** teacherId: the teacher the student will have after this change (it is applied apart, see changeTeacher). */
const updateStudent = async (student, data, { teacherId = student.teacherId } = {}) => {
    const changes = Object.fromEntries(STUDENT_FIELDS.filter(f => data[f] !== undefined).map(f => [f, data[f] === '' ? null : data[f]]));
    if (changes.email) changes.email = changes.email.trim().toLowerCase();
    if (changes.level === null) delete changes.level;
    await validateStudentData(changes, { excludeId: student.id });
    if (changes.name === null) throw new DomainError('nombre_requerido', 'El nombre es obligatorio.');
    const instrumentId = changes.instrumentId !== undefined ? changes.instrumentId : student.instrumentId;
    await assertTeacherTeaches({ teacherId: changes.teacherId !== undefined ? changes.teacherId : teacherId, instrumentId });
    if (changes.level !== undefined || instrumentId !== student.instrumentId) {
        await assertLevelOnLadder(changes.level ?? student.level, instrumentId);
    }
    if (changes.cityId !== undefined || teacherId !== student.teacherId) {
        changes.cityId = await resolveStudentCity({ cityId: changes.cityId, teacherId, currentCityId: student.cityId });
    }
    await student.update(changes);
    return student;
};

const resetPassword = async (user) => {
    const tempPassword = generateTempPassword();
    user.password = tempPassword;
    user.mustChangePassword = true;
    await user.save();
    return tempPassword;
};

module.exports = { generateTempPassword, createStudent, updateStudent, resetPassword };
