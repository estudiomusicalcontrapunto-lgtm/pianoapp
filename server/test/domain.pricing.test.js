const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePrices, resolvePaymentText, parseFee } = require('../domain/pricing');

const pereira = { monthlyFee: 260000, singleClassFee: null, paymentText: 'Nequi 300 000 0000' };

test('Pereira: mensualidad 260.000 y clase suelta = mensualidad ÷ 4 = 65.000', () => {
    assert.deepEqual(resolvePrices({ city: pereira }), { monthlyFee: 260000, singleClassFee: 65000, singleSource: 'mensualidad' });
});

test('cada ciudad tiene su mensualidad; la clase suelta definida por la academia gana sobre el ÷ 4', () => {
    assert.equal(resolvePrices({ city: { monthlyFee: 300000 } }).singleClassFee, 75000);
    const prices = resolvePrices({ city: { monthlyFee: 300000, singleClassFee: 80000 } });
    assert.equal(prices.monthlyFee, 300000);
    assert.equal(prices.singleClassFee, 80000);
    assert.equal(prices.singleSource, 'ciudad');
});

test('texto de pago: siempre el de la ciudad (cobra la academia, nunca el profesor)', () => {
    assert.deepEqual(resolvePaymentText({ city: pereira }), { text: pereira.paymentText, source: 'ciudad' });
    assert.equal(resolvePaymentText({ city: { monthlyFee: 1 } }).text, '');
});

test('los valores se escriben en pesos enteros; vacío solo si es opcional', () => {
    assert.deepEqual(parseFee('260.000', 'La mensualidad'), { value: 260000 });
    assert.deepEqual(parseFee(65000, 'La clase suelta'), { value: 65000 });
    assert.deepEqual(parseFee('', 'La clase suelta', { optional: true }), { value: null });
    assert.match(parseFee('', 'La mensualidad').error, /obligatoria/);
    assert.match(parseFee(-5, 'La mensualidad').error, /mayor que 0/);
    assert.match(parseFee(65000.5, 'La mensualidad').error, /sin decimales/);
});
