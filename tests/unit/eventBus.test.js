import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../../src/realtime/eventBus.js';

test('emit entrega el evento a los suscriptores con id incremental, tipo, fecha y payload', () => {
  const bus = createEventBus();
  const received = [];
  bus.subscribe((e) => received.push(e));
  const first = bus.emit('task.updated', { projectId: 3, sprintId: 7 });
  bus.emit('project.created', { projectId: 4 });
  assert.equal(received.length, 2);
  assert.deepEqual(received[0], first);
  assert.equal(first.type, 'task.updated');
  assert.equal(first.projectId, 3);
  assert.equal(first.sprintId, 7);
  assert.equal(received[1].id, first.id + 1);
  assert.match(first.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('emit sin payload y sin suscriptores no falla', () => {
  const bus = createEventBus();
  assert.equal(bus.emit('settings.updated').type, 'settings.updated');
  assert.equal(bus.listenerCount(), 0);
});

test('subscribe devuelve la función para cancelar y cuenta los listeners (sin límite de 10)', () => {
  const bus = createEventBus();
  const unsubscribers = Array.from({ length: 25 }, () => bus.subscribe(() => {}));
  assert.equal(bus.listenerCount(), 25);
  const seen = [];
  const off = bus.subscribe((e) => seen.push(e));
  bus.emit('a');
  off();
  bus.emit('b');
  assert.deepEqual(
    seen.map((e) => e.type),
    ['a'],
  );
  unsubscribers.forEach((u) => u());
  assert.equal(bus.listenerCount(), 0);
});

test('un payload no puede pisar id, type ni at', () => {
  const bus = createEventBus();
  const e = bus.emit('x', { projectId: 1 });
  assert.ok(Number.isInteger(e.id));
  assert.equal(e.type, 'x');
});
