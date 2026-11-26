// Cities ("sedes") and the values each one uses: monthly fee, single-class fee
// and payment text (only the academy sets prices). Also a teacher's city and
// own payment text, and the city rules for students, teachers and rooms (they must match).
const { Op } = require('sequelize');
const { sequelize, City, User, Room, TeacherRoom, Payment } = require('../models');
const { ROLES } = require('../domain/constants');
const { DomainError } = require('../domain/errors');
const { parseFee, resolvePrices } = require('../domain/pricing');
const { logAudit } = require('./audit');

const plain = (row) => row.get({ plain: true });

const cityJSON = (city) => {
    const data = plain(city);
    return { ...data, prices: resolvePrices({ city: data }) };
};

const listCities = async ({ includeInactive = true } = {}) => {
    const cities = await City.findAll({ where: includeInactive ? {} : { active: true }, order: [['name', 'ASC']] });
    return cities.map(cityJSON);
};

const findCity = async (cityId, { transaction } = {}) => {
    const city = cityId && await City.findByPk(cityId, { transaction });
    if (!city) throw new DomainError('ciudad_invalida', 'La ciudad no existe.', 404);
    return city;
};

const validateCityInput = async (input, { excludeId, partial = false } = {}) => {
    const values = {};
    if (!partial || input.name !== undefined) {
        const name = String(input.name || '').trim();
        if (!name) throw new DomainError('nombre_requerido', 'Escribe el nombre de la ciudad.');
        const existing = await City.findOne({ where: { name } });
        if (existing && existing.id !== excludeId) throw new DomainError('ciudad_repetida', `Ya existe la ciudad ${name}.`, 409);
        values.name = name;
    }
    if (!partial || input.monthlyFee !== undefined) {
        const fee = parseFee(input.monthlyFee, 'La mensualidad');
        if (fee.error) throw new DomainError('valor_invalido', fee.error);
        values.monthlyFee = fee.value;
    }
    if (!partial || input.singleClassFee !== undefined) {
        const fee = parseFee(input.singleClassFee, 'La clase suelta', { optional: true });
        if (fee.error) throw new DomainError('valor_invalido', fee.error);
        values.singleClassFee = fee.value;
    }
    if (!partial || input.paymentText !== undefined) {
        values.paymentText = input.paymentText ? String(input.paymentText).trim() : null;
    }
    if (input.active !== undefined) values.active = !!input.active;
    return values;
};

const createCity = async ({ input, actor }) => {
    const values = await validateCityInput(input);
    const city = await City.create(values);
    await logAudit({ entityType: 'city', entityId: city.id, action: 'crear', actorId: actor.id, details: values });
    return cityJSON(city);
};

const updateCity = async ({ cityId, input, actor }) => {
    const city = await findCity(cityId);
    const values = await validateCityInput(input, { excludeId: city.id, partial: true });
    if (values.active === false && city.active) {
        const people = await User.count({ where: { cityId: city.id, active: true, role: { [Op.in]: [ROLES.STUDENT, ROLES.TEACHER] } } });
        if (people) throw new DomainError('ciudad_en_uso', `No puedes desactivar ${city.name}: todavía tiene ${people} profesor(es) o estudiante(s) activos.`, 409);
        const othersActive = await City.count({ where: { active: true, id: { [Op.ne]: city.id } } });
        if (!othersActive) throw new DomainError('ultima_ciudad', `${city.name} es la única ciudad activa: la academia necesita al menos una.`, 409);
    }
    const before = plain(city);
    await city.update(values);
    await logAudit({
        entityType: 'city', entityId: city.id, action: 'actualizar', actorId: actor.id,
        details: { before: Object.fromEntries(Object.keys(values).map(k => [k, before[k]])), after: values },
    });
    return cityJSON(city);
};

/**
 * Deletes a city nobody uses: no students (also archived ones, who can come
 * back), no teachers, no rooms and no payments. Teachers already removed from
 * the academy only keep a link to it, which is cleared. The last city stays.
 */
const deleteCity = async ({ cityId, actor }) =>
    sequelize.transaction(async (transaction) => {
        const city = await findCity(cityId, { transaction });
        if (await City.count({ transaction }) <= 1) {
            throw new DomainError('ultima_ciudad', `${city.name} es la única ciudad: la academia necesita al menos una.`, 409);
        }
        const [students, teachers, rooms, payments] = await Promise.all([
            User.count({ where: { cityId: city.id, role: ROLES.STUDENT }, transaction }),
            User.count({ where: { cityId: city.id, role: ROLES.TEACHER, active: true }, transaction }),
            Room.count({ where: { cityId: city.id }, transaction }),
            Payment.count({ where: { cityId: city.id }, transaction }),
        ]);
        const uses = [
            students && `${students} estudiante(s)`,
            teachers && `${teachers} profesor(es)`,
            rooms && `${rooms} salón(es)`,
            payments && `${payments} pago(s)`,
        ].filter(Boolean);
        if (uses.length) {
            throw new DomainError(
                'ciudad_en_uso',
                `No puedes eliminar ${city.name} porque tiene ${uses.join(', ')}. Si ya no la usas, desactívala.`,
                409
            );
        }
        await User.update({ cityId: null }, { where: { cityId: city.id, role: ROLES.TEACHER, active: false }, transaction });
        await city.destroy({ transaction });
        await logAudit({ entityType: 'city', entityId: city.id, action: 'eliminar', actorId: actor.id, details: { name: city.name } }, { transaction });
    });

// The city to use when none is given: the only active one. With several, it must be chosen.
const defaultCityId = async ({ transaction } = {}) => {
    const cities = await City.findAll({ where: { active: true }, attributes: ['id'], transaction });
    if (cities.length === 1) return cities[0].id;
    throw new DomainError('ciudad_requerida', 'Elige la ciudad.');
};

const assertActiveCity = async (cityId, { transaction } = {}) => {
    const city = await findCity(cityId, { transaction });
    if (!city.active) throw new DomainError('ciudad_inactiva', `${city.name} está desactivada.`);
    return city;
};

/**
 * City of a student: their teacher's. A cityId given apart must match it.
 * Returns the cityId to store.
 */
const resolveStudentCity = async ({ cityId, teacherId, currentCityId = null }, { transaction } = {}) => {
    if (teacherId) {
        const teacher = await User.findByPk(teacherId, { attributes: ['id', 'name', 'cityId'], transaction });
        if (teacher?.cityId) {
            if (cityId && cityId !== teacher.cityId) {
                throw new DomainError('ciudad_distinta', `${teacher.name} enseña en otra ciudad. Elige un profesor de la ciudad del estudiante.`);
            }
            return teacher.cityId;
        }
    }
    if (cityId) return (await assertActiveCity(cityId, { transaction })).id;
    return currentCityId || defaultCityId({ transaction });
};

const TEACHER_BILLING_FIELDS = ['cityId'];

/**
 * The academy sets a teacher's city. Teachers never have their own prices nor
 * payment text: the academy collects, with the city's values and text.
 * A teacher changes city only without students or rooms there.
 */
const updateTeacherBilling = async ({ teacherId, input, actor }) =>
    sequelize.transaction(async (transaction) => {
        const teacher = await User.findOne({ where: { id: teacherId, role: ROLES.TEACHER, active: true }, transaction });
        if (!teacher) throw new DomainError('profesor_no_encontrado', 'Profesor no encontrado.', 404);
        const values = {};
        if (input.cityId !== undefined && input.cityId !== teacher.cityId) {
            await assertActiveCity(input.cityId, { transaction });
            const students = await User.count({ where: { role: ROLES.STUDENT, teacherId: teacher.id, active: true }, transaction });
            const rooms = await TeacherRoom.count({ where: { teacherId: teacher.id }, transaction });
            if (students || rooms) {
                throw new DomainError(
                    'profesor_con_estudiantes',
                    'Para cambiar de ciudad al profesor, primero reasigna sus estudiantes y quítale sus salones.',
                    409
                );
            }
            values.cityId = input.cityId;
        }
        const before = Object.fromEntries(TEACHER_BILLING_FIELDS.map(f => [f, teacher[f]]));
        await teacher.update(values, { transaction });
        await logAudit({
            entityType: 'teacher', entityId: teacher.id, action: 'valores_cobro', actorId: actor.id,
            details: { before, after: values },
        }, { transaction });
        return teacher;
    });

// Teachers assigned to a room must be from the room's city
const assertTeachersInRoomCity = async (room, teachers) => {
    const others = teachers.filter(t => t.cityId && room.cityId && t.cityId !== room.cityId);
    if (others.length) {
        throw new DomainError('ciudad_distinta', `${others.map(t => t.name).join(', ')} enseña(n) en otra ciudad que ${room.name}.`);
    }
};

const assertRoomNameFree = async ({ name, cityId, excludeId }) => {
    const existing = await Room.findOne({ where: { name, cityId } });
    if (existing && existing.id !== excludeId) throw new DomainError('salon_repetido', 'Ya existe un salón con ese nombre en esa ciudad.');
};

module.exports = {
    listCities, createCity, updateCity, deleteCity, findCity, defaultCityId, assertActiveCity,
    resolveStudentCity, updateTeacherBilling, assertTeachersInRoomCity, assertRoomNameFree,
};
