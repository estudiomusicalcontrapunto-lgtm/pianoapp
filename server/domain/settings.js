// Business rules the academy can change. Values missing from the Settings
// table fall back to these defaults.

const SETTING_DEFINITIONS = [
    { key: 'horas_minimas_aviso', label: 'Horas mínimas de aviso para cancelar o cambiar una clase', type: 'integer', min: 0, max: 168, default: 12 },
    { key: 'max_reprogramaciones_por_ciclo', label: 'Reprogramaciones permitidas por ciclo', type: 'integer', min: 0, max: 10, default: 1 },
    { key: 'duracion_ciclo_semanas', label: 'Duración del ciclo (semanas)', type: 'integer', min: 1, max: 12, default: 4 },
    { key: 'horas_cupo_apartado', label: 'Horas que dura un cupo apartado', type: 'integer', min: 1, max: 336, default: 48 },
    { key: 'precio_clase_suelta', label: 'Precio clase suelta (COP)', type: 'integer', min: 0, max: 100000000, default: 75000 },
    { key: 'precio_paquete_4', label: 'Precio paquete de 4 clases (COP)', type: 'integer', min: 0, max: 100000000, default: 260000 },
    { key: 'duracion_clase_minutos', label: 'Duración de una clase (minutos)', type: 'integer', min: 15, max: 240, default: 60 },
    { key: 'dias_recordatorio_pago', label: 'Días antes del nuevo ciclo para recordar el pago', type: 'integer', min: 0, max: 30, default: 3 },
    { key: 'dias_vigencia_anuncio', label: 'Días que se muestra un anuncio (por defecto)', type: 'integer', min: 1, max: 365, default: 15 },
    { key: 'dias_avisos_leidos', label: 'Días que siguen a la vista los avisos ya leídos', type: 'integer', min: 1, max: 180, default: 14 },
    // Monthly billing (the fees themselves are per city, in "Ciudades")
    { key: 'dia_limite_pago', label: 'Último día del mes para pagar la mensualidad', type: 'integer', min: 1, max: 28, default: 5 },
    { key: 'dias_pago_primer_cobro', label: 'Días que tiene un alumno nuevo para pagar su primer cobro', type: 'integer', min: 1, max: 30, default: 3 },
    { key: 'dias_extra_comprobante_rechazado', label: 'Días para subir otro comprobante si se rechaza después del día límite', type: 'integer', min: 0, max: 10, default: 1 },
    { key: 'tope_cambios_mes', label: 'Cambios de clase por alumno al mes (0 = sin tope)', type: 'integer', min: 0, max: 31, default: 0 },
    // monthlyFeeCoversAllClasses
    { key: 'mensualidad_cubre_todas_las_clases', label: 'La mensualidad cubre todas las clases del mes (también la 5.ª semana)', type: 'boolean', default: false },
    { key: 'hora_apertura', label: 'Hora de apertura', type: 'time', default: '07:00' },
    { key: 'hora_cierre', label: 'Hora de cierre', type: 'time', default: '21:00' },
];

const DEFAULT_SETTINGS = Object.fromEntries(SETTING_DEFINITIONS.map(d => [d.key, d.default]));

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const validateValue = (definition, value) => {
    if (definition.type === 'integer') {
        const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        if (!Number.isInteger(number)) return { error: `"${definition.label}" debe ser un número entero.` };
        if (number < definition.min || number > definition.max) {
            return { error: `"${definition.label}" debe estar entre ${definition.min} y ${definition.max}.` };
        }
        return { value: number };
    }
    if (definition.type === 'boolean') {
        if (value === true || value === 'true') return { value: true };
        if (value === false || value === 'false') return { value: false };
        return { error: `"${definition.label}" debe ser sí o no.` };
    }
    if (definition.type === 'month') {
        if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
            return { error: `"${definition.label}" debe tener el formato AAAA-MM.` };
        }
        return { value };
    }
    if (definition.type === 'choice') {
        if (!definition.options.some(o => o.value === value)) return { error: `"${definition.label}" no es una opción válida.` };
        return { value };
    }
    if (definition.type === 'time') {
        if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
            return { error: `"${definition.label}" debe tener el formato HH:mm.` };
        }
        return { value };
    }
    return { error: `Tipo de ajuste desconocido: ${definition.type}` };
};

// Validates a partial update. Returns { values, errors }; unknown keys are errors.
const validateSettingsUpdate = (input, current = DEFAULT_SETTINGS) => {
    const values = {};
    const errors = [];
    for (const [key, raw] of Object.entries(input || {})) {
        const definition = SETTING_DEFINITIONS.find(d => d.key === key);
        if (!definition) {
            errors.push(`Ajuste desconocido: ${key}`);
            continue;
        }
        const result = validateValue(definition, raw);
        if (result.error) errors.push(result.error);
        else values[key] = result.value;
    }

    const merged = { ...current, ...values };
    if (merged.hora_apertura >= merged.hora_cierre) {
        errors.push('La hora de apertura debe ser anterior a la hora de cierre.');
    }
    return { values, errors };
};

// Builds the effective settings from stored rows ({ key, value } with JSON text values)
const resolveSettings = (rows) => {
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
        if (!(row.key in DEFAULT_SETTINGS)) continue;
        try {
            settings[row.key] = JSON.parse(row.value);
        } catch {
            // A corrupt value keeps the default
        }
    }
    return settings;
};

module.exports = {
    SETTING_DEFINITIONS,
    DEFAULT_SETTINGS,
    validateSettingsUpdate,
    resolveSettings,
};
