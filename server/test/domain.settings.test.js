const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, validateSettingsUpdate, resolveSettings } = require('../domain/settings');

test('los valores por defecto son los de la academia', () => {
    assert.equal(DEFAULT_SETTINGS.horas_minimas_aviso, 12);
    assert.equal(DEFAULT_SETTINGS.max_reprogramaciones_por_ciclo, 1);
    assert.equal(DEFAULT_SETTINGS.duracion_ciclo_semanas, 4);
    assert.equal(DEFAULT_SETTINGS.horas_cupo_apartado, 48);
    assert.equal(DEFAULT_SETTINGS.precio_clase_suelta, 75000);
    assert.equal(DEFAULT_SETTINGS.precio_paquete_4, 260000);
});

test('parámetros del cobro mensual: día límite 5, la 5.ª semana no se cobra, sin tope de cambios', () => {
    assert.equal(DEFAULT_SETTINGS.dia_limite_pago, 5);
    assert.equal(DEFAULT_SETTINGS.dias_pago_primer_cobro, 3);
    assert.equal(DEFAULT_SETTINGS.dias_extra_comprobante_rechazado, 1);
    assert.equal(DEFAULT_SETTINGS.tope_cambios_mes, 0);
    assert.equal(DEFAULT_SETTINGS.mensualidad_cubre_todas_las_clases, false);
    // The academy collects every payment: there is no per-teacher payment text
    assert.equal('texto_pago_por_profesor' in DEFAULT_SETTINGS, false);
});

test('los sí/no aceptan true/false y rechazan otra cosa', () => {
    assert.deepEqual(validateSettingsUpdate({ mensualidad_cubre_todas_las_clases: 'true' }).values, { mensualidad_cubre_todas_las_clases: true });
    assert.deepEqual(validateSettingsUpdate({ mensualidad_cubre_todas_las_clases: false }).values, { mensualidad_cubre_todas_las_clases: false });
    assert.equal(validateSettingsUpdate({ mensualidad_cubre_todas_las_clases: 'tal vez' }).errors.length, 1);
    assert.equal(validateSettingsUpdate({ dia_limite_pago: 29 }).errors.length, 1);
});

test('acepta enteros enviados como texto', () => {
    const { values, errors } = validateSettingsUpdate({ horas_minimas_aviso: '12' });
    assert.deepEqual(errors, []);
    assert.deepEqual(values, { horas_minimas_aviso: 12 });
});

test('rechaza claves desconocidas, decimales y valores fuera de rango', () => {
    const { errors } = validateSettingsUpdate({
        clave_inventada: 1,
        precio_paquete_4: 2600.5,
        max_reprogramaciones_por_ciclo: -1,
    });
    assert.equal(errors.length, 3);
});

test('la hora de apertura debe ser anterior a la de cierre', () => {
    const { errors } = validateSettingsUpdate({ hora_apertura: '22:00' });
    assert.match(errors.join(' '), /apertura debe ser anterior/);
    assert.deepEqual(validateSettingsUpdate({ hora_apertura: '7:00' }).errors.length, 1);
});

test('resolveSettings combina filas guardadas con los valores por defecto', () => {
    const settings = resolveSettings([
        { key: 'horas_minimas_aviso', value: '12' },
        { key: 'precio_paquete_4', value: 'no-es-json' },
        { key: 'obsoleta', value: '1' },
    ]);
    assert.equal(settings.horas_minimas_aviso, 12);
    assert.equal(settings.precio_paquete_4, 260000);
    assert.equal('obsoleta' in settings, false);
});
