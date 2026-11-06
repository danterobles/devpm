import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THRESHOLDS, semaphore } from '../../src/modules/dashboard/thresholds.js';

const T = DEFAULT_THRESHOLDS;

test('sin valor (null) no hay semáforo', () => {
  for (const id of ['k3', 'k4', 'k5', 'k6', 'k7', 'k9', 'k10', 'k11', 'k15', 'k16']) {
    assert.equal(semaphore(id, null, T), null, id);
  }
});

test('K3 y K4 (SPI/CPI): ≥ 0.95 verde, 0.85–0.95 ámbar, < 0.85 rojo', () => {
  for (const id of ['k3', 'k4']) {
    assert.equal(semaphore(id, 1.2, T), 'green');
    assert.equal(semaphore(id, 0.95, T), 'green');
    assert.equal(semaphore(id, 0.9499, T), 'amber');
    assert.equal(semaphore(id, 0.85, T), 'amber');
    assert.equal(semaphore(id, 0.8499, T), 'red');
    assert.equal(semaphore(id, 0, T), 'red');
  }
});

test('K5 (consumo): se compara contra el avance — ≤ avance+10 verde, ≤ avance+20 ámbar, > rojo', () => {
  assert.equal(semaphore('k5', 50, T, { progress: 45 }), 'green'); // 50 ≤ 55
  assert.equal(semaphore('k5', 55, T, { progress: 45 }), 'green'); // límite inclusivo
  assert.equal(semaphore('k5', 55.1, T, { progress: 45 }), 'amber');
  assert.equal(semaphore('k5', 65, T, { progress: 45 }), 'amber');
  assert.equal(semaphore('k5', 65.1, T, { progress: 45 }), 'red');
  assert.equal(semaphore('k5', 10, T, { progress: 0 }), 'green');
  assert.equal(semaphore('k5', 25, T, { progress: 0 }), 'red');
  assert.equal(semaphore('k5', 50, T, {}), null); // sin avance no se puede comparar
});

test('K6 (utilización): 75–95 verde; 60–75 o 95–105 ámbar; < 60 o > 105 rojo', () => {
  assert.equal(semaphore('k6', 75, T), 'green');
  assert.equal(semaphore('k6', 95, T), 'green');
  assert.equal(semaphore('k6', 85, T), 'green');
  assert.equal(semaphore('k6', 74.9, T), 'amber');
  assert.equal(semaphore('k6', 60, T), 'amber');
  assert.equal(semaphore('k6', 95.1, T), 'amber');
  assert.equal(semaphore('k6', 105, T), 'amber');
  assert.equal(semaphore('k6', 59.9, T), 'red');
  assert.equal(semaphore('k6', 105.1, T), 'red');
  assert.equal(semaphore('k6', 0, T), 'red');
});

test('K7 (sobreasignados): 0 verde, 1–2 ámbar, ≥ 3 rojo', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 10].map((v) => semaphore('k7', v, T)),
    ['green', 'amber', 'amber', 'red', 'red'],
  );
});

test('K9 (compromiso): ≥ 85 verde, 70–85 ámbar, < 70 rojo', () => {
  assert.deepEqual(
    [100, 85, 84.9, 70, 69.9].map((v) => semaphore('k9', v, T)),
    ['green', 'green', 'amber', 'amber', 'red'],
  );
});

test('K10 (vencidas): 0 verde, 1–5 ámbar, > 5 rojo', () => {
  assert.deepEqual(
    [0, 1, 5, 6].map((v) => semaphore('k10', v, T)),
    ['green', 'amber', 'amber', 'red'],
  );
});

test('K11 (bloqueadas): 0 verde, 1–3 ámbar, > 3 rojo', () => {
  assert.deepEqual(
    [0, 1, 3, 4].map((v) => semaphore('k11', v, T)),
    ['green', 'amber', 'amber', 'red'],
  );
});

test('K15 (hitos vencidos): 0 verde, 1 ámbar, > 1 rojo', () => {
  assert.deepEqual(
    [0, 1, 2].map((v) => semaphore('k15', v, T)),
    ['green', 'amber', 'red'],
  );
});

test('K16 (registro de la semana): ≥ 95 verde, 80–95 ámbar, < 80 rojo', () => {
  assert.deepEqual(
    [100, 95, 94.9, 80, 79.9].map((v) => semaphore('k16', v, T)),
    ['green', 'green', 'amber', 'amber', 'red'],
  );
});

test('los KPIs sin semáforo (K1, K2, K8, K12, K13, K14) devuelven null', () => {
  for (const id of ['k1', 'k2', 'k8', 'k12', 'k13', 'k14'])
    assert.equal(semaphore(id, 10, T), null, id);
});

test('usa los umbrales recibidos (configurables), no los de fábrica', () => {
  const custom = structuredClone(T);
  custom.k10 = { greenMax: 2, amberMax: 10 };
  assert.equal(semaphore('k10', 2, custom), 'green');
  assert.equal(semaphore('k10', 10, custom), 'amber');
  assert.equal(semaphore('k10', 11, custom), 'red');
  assert.equal(semaphore('k10', 2, T), 'amber'); // los de fábrica no cambian
});
