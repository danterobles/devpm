import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';

test('migrate: aplica en orden, registra versiones y es idempotente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE b (id INTEGER);');
  writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER);');
  writeFileSync(join(dir, 'notas.txt'), 'ignorar');
  const db = openDb(':memory:');

  assert.deepEqual(migrate(db, dir), ['001_a', '002_b']);
  assert.deepEqual(migrate(db, dir), []);
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all(),
    ['001_a', '002_b'],
  );
});

test('migrate: una migración fallida hace rollback y no se registra', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  writeFileSync(join(dir, '001_mala.sql'), 'CREATE TABLE x (id INTEGER); SELECT * FROM no_existe;');
  const db = openDb(':memory:');

  assert.throws(() => migrate(db, dir));
  assert.equal(db.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'x'").pluck().get(), 0);
  assert.equal(db.prepare('SELECT count(*) FROM schema_migrations').pluck().get(), 0);
});

test('connection: aplica PRAGMAs de integridad', () => {
  const db = openDb(':memory:');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
});
