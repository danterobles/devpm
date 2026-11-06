import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, diffDays, isWeekend, setClock, today } from '../../src/lib/dates.js';

afterEach(() => setClock());

test('addDays y diffDays cruzan meses y años', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-01-01', '2026-01-31'), 30);
});

test('isWeekend identifica sábado y domingo', () => {
  assert.equal(isWeekend('2026-11-07'), true); // sábado
  assert.equal(isWeekend('2026-11-09'), false); // lunes
});

test('today usa el reloj inyectado y la zona horaria', () => {
  setClock(() => new Date('2026-11-07T03:30:00Z')); // aún 6 nov en Ciudad de México
  assert.equal(today('America/Mexico_City'), '2026-11-06');
  assert.equal(today('UTC'), '2026-11-07');
});
