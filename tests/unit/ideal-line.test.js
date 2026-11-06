import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idealLine } from '../../src/modules/burndown/ideal.js';

const days = (from, n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

test('sprint de 2 semanas (lun-vie ×2): primer día hábil = comprometidos, último = 0, lineal por día hábil', () => {
  const list = days('2026-05-11', 12); // lunes 11 a viernes 22
  const ideal = idealLine(list, 90);
  // 10 días hábiles → baja 10 puntos por día hábil
  assert.equal(ideal[0], 90); // lun 11
  assert.equal(ideal[1], 80);
  assert.equal(ideal[4], 50); // vie 15
  assert.equal(ideal[11], 0); // vie 22
});

test('los fines de semana repiten el valor del día hábil anterior', () => {
  const ideal = idealLine(days('2026-05-11', 12), 90);
  assert.equal(ideal[5], ideal[4]); // sáb 16 = vie 15
  assert.equal(ideal[6], ideal[4]); // dom 17 = vie 15
  assert.equal(ideal[7], 40); // lun 18 retoma la bajada
});

test('un sprint de un solo día hábil termina en 0', () => {
  assert.deepEqual(idealLine(['2026-05-13'], 10), [0]);
});

test('si el sprint inicia en fin de semana, los días previos al primer hábil valen el compromiso', () => {
  const ideal = idealLine(days('2026-05-09', 5), 8); // sáb 9, dom 10, lun 11, mar 12, mié 13
  assert.deepEqual(ideal.slice(0, 3), [8, 8, 8]);
  assert.equal(ideal[4], 0); // último día hábil
  assert.equal(ideal[3], 4); // 3 hábiles → 8, 4, 0
});

test('después del último día hábil (días extra por retraso) el ideal es 0', () => {
  const ideal = idealLine(days('2026-05-18', 7), 10); // lun 18 a dom 24, el sprint terminó el vie 22
  assert.equal(ideal[4], 0);
  assert.equal(ideal[5], 0);
  assert.equal(ideal[6], 0);
});

test('compromiso 0 o decimales (horas) y redondeo a 2 decimales', () => {
  assert.deepEqual(idealLine(days('2026-05-11', 3), 0), [0, 0, 0]);
  const ideal = idealLine(days('2026-05-11', 3), 100); // 3 hábiles → 100, 50, 0
  assert.deepEqual(ideal, [100, 50, 0]);
  assert.deepEqual(idealLine(days('2026-05-11', 4), 10), [10, 6.67, 3.33, 0]);
});

test('sin días devuelve una lista vacía', () => {
  assert.deepEqual(idealLine([], 10), []);
});
