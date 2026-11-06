import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import * as f from '../helpers/factories.js';
import { diff, recordAudit } from '../../src/lib/audit.js';

test('diff: solo campos modificados e ignora updated_at', () => {
  const changes = diff(
    { name: 'A', status: 'planning', updated_at: '1' },
    { name: 'A', status: 'active', note: 'x', updated_at: '2' },
  );
  assert.deepEqual(changes, { status: ['planning', 'active'], note: [null, 'x'] });
});

test('recordAudit: guarda la entrada con JSON de cambios', () => {
  const db = createTestDb();
  const u = f.user(db);
  const id = recordAudit(db, {
    userId: u,
    entity: 'projects',
    entityId: 7,
    action: 'update',
    changes: { status: ['planning', 'active'] },
  });
  const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id);
  assert.equal(row.entity, 'projects');
  assert.deepEqual(JSON.parse(row.changes), { status: ['planning', 'active'] });
});

test('recordAudit: acción inválida se rechaza y changes puede ser nulo', () => {
  const db = createTestDb();
  assert.throws(
    () => recordAudit(db, { entity: 'x', entityId: 1, action: 'hackear' }),
    /constraint/i,
  );
  const id = recordAudit(db, { entity: 'x', entityId: 1, action: 'delete' });
  assert.equal(db.prepare('SELECT changes FROM audit_log WHERE id = ?').pluck().get(id), null);
});
