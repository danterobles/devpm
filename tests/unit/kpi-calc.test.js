import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDays,
  elapsedFraction,
  ratio,
  round1,
  weekRange,
  lastDays,
} from '../../src/modules/dashboard/calc.js';

test('ratio: división segura (0 o nulo en el denominador → null)', () => {
  assert.equal(ratio(1, 4), 0.25);
  assert.equal(ratio(0, 4), 0);
  assert.equal(ratio(5, 0), null);
  assert.equal(ratio(5, null), null);
  assert.equal(ratio(null, 5), null);
});

test('round1 redondea a un decimal y respeta null', () => {
  assert.equal(round1(1.26), 1.3);
  assert.equal(round1(1.24), 1.2);
  assert.equal(round1(null), null);
  assert.equal(round1(10), 10);
});

test('elapsedFraction: % transcurrido del plan entre 0 y 1', () => {
  assert.equal(elapsedFraction('2026-01-01', '2026-01-11', '2025-12-25'), 0); // aún no empieza
  assert.equal(elapsedFraction('2026-01-01', '2026-01-11', '2026-01-01'), 0);
  assert.equal(elapsedFraction('2026-01-01', '2026-01-11', '2026-01-06'), 0.5);
  assert.equal(elapsedFraction('2026-01-01', '2026-01-11', '2026-01-11'), 1);
  assert.equal(elapsedFraction('2026-01-01', '2026-01-11', '2026-03-01'), 1); // vencido
  assert.equal(elapsedFraction('2026-01-05', '2026-01-05', '2026-01-04'), 0); // plan de un solo día
  assert.equal(elapsedFraction('2026-01-05', '2026-01-05', '2026-01-05'), 1);
});

test('businessDays: días hábiles (lunes a viernes) del rango, inclusivo', () => {
  assert.deepEqual(businessDays('2026-05-08', '2026-05-12'), [
    '2026-05-08',
    '2026-05-11',
    '2026-05-12',
  ]); // vie, lun, mar
  assert.deepEqual(businessDays('2026-05-09', '2026-05-10'), []); // fin de semana
  assert.equal(businessDays('2026-05-11', '2026-05-22').length, 10);
  assert.deepEqual(businessDays('2026-05-12', '2026-05-11'), []); // rango invertido
});

test('weekRange: lunes a domingo de la semana de una fecha', () => {
  assert.deepEqual(weekRange('2026-05-13'), { from: '2026-05-11', to: '2026-05-17' }); // miércoles
  assert.deepEqual(weekRange('2026-05-11'), { from: '2026-05-11', to: '2026-05-17' }); // lunes
  assert.deepEqual(weekRange('2026-05-17'), { from: '2026-05-11', to: '2026-05-17' }); // domingo
});

test('lastDays: últimos N días terminando hoy, inclusivo (30 días = hoy − 29)', () => {
  assert.deepEqual(lastDays('2026-05-13', 30), { from: '2026-04-14', to: '2026-05-13' });
  assert.deepEqual(lastDays('2026-05-13', 1), { from: '2026-05-13', to: '2026-05-13' });
});
