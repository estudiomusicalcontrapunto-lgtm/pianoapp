const { sequelize, Setting } = require('../models');
const { resolveSettings, validateSettingsUpdate } = require('../domain/settings');
const { logAudit } = require('./audit');

const getSettings = async (options = {}) => {
    const rows = await Setting.findAll({ transaction: options.transaction });
    return resolveSettings(rows);
};

// Returns { settings } or { errors }
const updateSettings = async (input, actorId) => {
    const current = await getSettings();
    const { values, errors } = validateSettingsUpdate(input, current);
    if (errors.length) return { errors };

    await sequelize.transaction(async (transaction) => {
        for (const [key, value] of Object.entries(values)) {
            if (current[key] === value) continue;
            await Setting.upsert({ key, value: JSON.stringify(value) }, { transaction });
            await logAudit({
                entityType: 'setting',
                entityId: key,
                action: 'update',
                fromStatus: JSON.stringify(current[key]),
                toStatus: JSON.stringify(value),
                actorId,
            }, { transaction });
        }
    });

    return { settings: await getSettings() };
};

module.exports = { getSettings, updateSettings };
