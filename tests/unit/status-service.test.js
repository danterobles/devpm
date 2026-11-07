import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStatusService } from '../../src/modules/status/status.service.js';
import { createTestDb } from '../helpers/testDb.js';

// Estado del sistema y sus alertas (RF-172).
const NOW = new Date('2026-05-13T18:00:00Z');
const quiet = {
  snapshot: () => ({ windowMinutes: 15, recentServerErrors: 0, p95Ms: 20, uptimeSeconds: 5 }),
};

function make(overrides = {}) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpm-status-'));
  const svc = createStatusService({
    db: createTestDb(),
    config: { databasePath: ':memory:', backupDir, env: 'test' },
    metrics: quiet,
    version: '9.9.9',
    now: () => NOW,
    ...overrides,
  });
  return { svc, backupDir, done: () => fs.rmSync(backupDir, { recursive: true, force: true }) };
}
const messages = (s) => s.alerts.map((a) => `${a.level}: ${a.message}`).join('\n');

test('sin respaldos avisa; con uno reciente no hay alertas y todo está bien', () => {
  const { svc, backupDir, done } = make();
  const empty = svc.snapshot();
  assert.match(messages(empty), /warn: No hay respaldos/);
  assert.equal(empty.ok, true, 'una advertencia no es un error');
  fs.writeFileSync(path.join(backupDir, 'devpm-20260513-0200.db'), 'x');
  const fresh = svc.snapshot();
  assert.deepEqual(fresh.alerts, []);
  assert.equal(fresh.backup.last.name, 'devpm-20260513-0200.db');
  assert.equal(fresh.version, '9.9.9');
  assert.equal(fresh.database.ok, true);
  assert.equal(fresh.database.counts.users, 0);
  assert.equal(fresh.attachments.count, 0);
  done();
});

test('un respaldo de más de 48 horas, errores del servidor y latencia alta generan alertas', () => {
  const { svc, backupDir, done } = make({
    metrics: { snapshot: () => ({ windowMinutes: 15, recentServerErrors: 3, p95Ms: 450 }) },
  });
  fs.writeFileSync(path.join(backupDir, 'devpm-20260510-0200.db'), 'x');
  const s = svc.snapshot();
  assert.match(messages(s), /warn: El último respaldo tiene más de 48 horas/);
  assert.match(messages(s), /error: 3 error\(es\) del servidor en los últimos 15 minutos/);
  assert.match(messages(s), /warn: Latencia alta: p95 de 450 ms/);
  assert.equal(s.ok, false);
  done();
});

test('si la base no responde es un error y el resto de la pantalla sigue funcionando', () => {
  const broken = {
    prepare: () => {
      throw new Error('disco lleno');
    },
  };
  const { svc, done } = make({ db: broken });
  const s = svc.snapshot();
  assert.equal(s.database.ok, false);
  assert.match(messages(s), /error: La base de datos no responde: disco lleno/);
  assert.equal(s.ok, false);
  assert.deepEqual(s.attachments, { count: 0, bytes: 0 });
  done();
});

test('la carpeta de respaldos inexistente o con archivos ajenos no rompe la pantalla', () => {
  const { svc, backupDir, done } = make();
  fs.writeFileSync(path.join(backupDir, 'notas.txt'), 'x');
  assert.equal(svc.snapshot().backup.last, null);
  fs.rmSync(backupDir, { recursive: true, force: true });
  assert.equal(svc.snapshot().backup.last, null);
  done();
});
