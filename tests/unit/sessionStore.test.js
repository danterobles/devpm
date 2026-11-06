import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import { SqliteSessionStore } from '../../src/modules/auth/sqliteSessionStore.js';

let db;
let store;
const call = (fn, ...args) =>
  new Promise((res, rej) => fn.call(store, ...args, (e, r) => (e ? rej(e) : res(r))));
const future = () => ({ cookie: { expires: new Date(Date.now() + 60_000).toISOString() } });

beforeEach(() => {
  db = createTestDb();
  store = new SqliteSessionStore(db);
});

test('store: set/get/destroy de una sesión', async () => {
  await call(store.set, 's1', { ...future(), userId: 7 });
  assert.equal((await call(store.get, 's1')).userId, 7);
  await call(store.destroy, 's1');
  assert.equal(await call(store.get, 's1'), null);
});

test('store: set sobre un sid existente actualiza (upsert)', async () => {
  await call(store.set, 's1', { ...future(), n: 1 });
  await call(store.set, 's1', { ...future(), n: 2 });
  assert.equal((await call(store.get, 's1')).n, 2);
  assert.equal(db.prepare('SELECT count(*) FROM sessions').pluck().get(), 1);
});

test('store: una sesión vencida no se devuelve y prune la elimina', async () => {
  await call(store.set, 'viva', future());
  await call(store.set, 'vieja', {
    cookie: { expires: new Date(Date.now() - 1000).toISOString() },
  });
  assert.equal(await call(store.get, 'vieja'), null);
  assert.equal(store.prune(), 1);
  assert.ok(await call(store.get, 'viva'));
});

test('store: sin expires usa el TTL por defecto', async () => {
  await call(store.set, 's1', { cookie: {} });
  const exp = db.prepare('SELECT expires_at FROM sessions').pluck().get();
  assert.ok(exp > Date.now() + 7 * 3600_000);
});

test('store: touch extiende la expiración', async () => {
  await call(store.set, 's1', future());
  const before = db.prepare('SELECT expires_at FROM sessions').pluck().get();
  await call(store.touch, 's1', {
    cookie: { expires: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.ok(db.prepare('SELECT expires_at FROM sessions').pluck().get() > before);
});

test('store: destroyByUser cierra solo las sesiones de ese usuario; length cuenta vigentes', async () => {
  await call(store.set, 'a', { ...future(), userId: 1 });
  await call(store.set, 'b', { ...future(), userId: 1 });
  await call(store.set, 'c', { ...future(), userId: 2 });
  assert.equal(await call(store.length), 3);
  assert.equal(store.destroyByUser(1), 2);
  assert.equal(await call(store.length), 1);
});

test('store: un error de BD llega al callback', async () => {
  const failing = new SqliteSessionStore(db);
  failing.q.get = {
    get: () => {
      throw new Error('boom');
    },
  };
  await assert.rejects(
    new Promise((res, rej) => failing.get('x', (e, r) => (e ? rej(e) : res(r)))),
    /boom/,
  );
});
