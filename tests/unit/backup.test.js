import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { backupDatabase, backupName } from '../../src/db/backup.js';
import { loadConfig } from '../../src/config/index.js';

// RNF-09: respaldo en caliente (VACUUM INTO) con retención configurable.
const dirs = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpm-backup-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fileDb(dir) {
  const db = openDb(path.join(dir, 'devpm.db'));
  migrate(db);
  db.prepare(
    "INSERT INTO clients (type, name, department) VALUES ('internal', 'Finanzas', 'TI')",
  ).run();
  return db;
}
const NOW = new Date('2026-05-13T15:04:59Z');
const names = (dir) => fs.readdirSync(dir).sort();

test('backupName: devpm-AAAAMMDD-HHmm.db en UTC', () => {
  assert.equal(backupName(NOW), 'devpm-20260513-1504.db');
  assert.equal(backupName(new Date('2026-01-02T03:04:00Z')), 'devpm-20260102-0304.db');
});

test('crea una copia consistente con los mismos datos y la integridad verificada', () => {
  const dir = tmp();
  const db = fileDb(dir);
  const result = backupDatabase({
    db,
    dir: path.join(dir, 'backups'),
    retentionDays: 14,
    now: NOW,
  });
  assert.equal(path.basename(result.file), 'devpm-20260513-1504.db');
  assert.ok(result.bytes > 0);
  const copy = new Database(result.file, { readonly: true });
  assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(copy.prepare('SELECT name FROM clients').pluck().get(), 'Finanzas');
  assert.equal(
    copy.prepare('SELECT count(*) FROM schema_migrations').pluck().get(),
    fs
      .readdirSync(new URL('../../src/db/migrations', import.meta.url))
      .filter((f) => f.endsWith('.sql')).length,
  );
  copy.close();
  db.close();
});

test('es en caliente: la base sigue usable y recibe escrituras durante y después del respaldo', () => {
  const dir = tmp();
  const db = fileDb(dir);
  const writer = openDb(path.join(dir, 'devpm.db')); // otra conexión escribiendo
  writer
    .prepare("INSERT INTO clients (type, name, department) VALUES ('internal', 'Antes', 'TI')")
    .run();
  const result = backupDatabase({ db, dir: path.join(dir, 'b'), retentionDays: 14, now: NOW });
  writer
    .prepare("INSERT INTO clients (type, name, department) VALUES ('internal', 'Después', 'TI')")
    .run();
  const copy = new Database(result.file, { readonly: true });
  assert.deepEqual(copy.prepare('SELECT name FROM clients ORDER BY id').pluck().all(), [
    'Finanzas',
    'Antes',
  ]);
  assert.equal(db.prepare('SELECT count(*) FROM clients').pluck().get(), 3);
  copy.close();
  writer.close();
  db.close();
});

test('la copia es un solo archivo (sin -wal ni -shm) y se puede abrir sin la original', () => {
  const dir = tmp();
  const db = fileDb(dir);
  const out = path.join(dir, 'b');
  backupDatabase({ db, dir: out, retentionDays: 14, now: NOW });
  db.close();
  fs.rmSync(path.join(dir, 'devpm.db'));
  assert.deepEqual(names(out), ['devpm-20260513-1504.db']);
});

test('dos respaldos en el mismo minuto no se pisan (sufijo numérico)', () => {
  const dir = tmp();
  const db = fileDb(dir);
  const out = path.join(dir, 'b');
  const a = backupDatabase({ db, dir: out, retentionDays: 14, now: NOW });
  const b = backupDatabase({ db, dir: out, retentionDays: 14, now: NOW });
  assert.notEqual(a.file, b.file);
  assert.deepEqual(names(out), ['devpm-20260513-1504-2.db', 'devpm-20260513-1504.db']);
  db.close();
});

test('retención: elimina solo los respaldos más antiguos que N días y no toca otros archivos', () => {
  const dir = tmp();
  const db = fileDb(dir);
  const out = path.join(dir, 'b');
  fs.mkdirSync(out);
  for (const name of [
    'devpm-20260101-0000.db', // 132 días
    'devpm-20260428-2359.db', // 14 días y 15 minutos: vencido
    'devpm-20260429-1504.db', // exactamente 14 días: se conserva
    'devpm-20260510-0900.db', // reciente
    'devpm-20260428-2359-2.db', // vencido con sufijo
    'notas.txt', // ajeno
    'devpm.db', // la BD en sí no coincide con el patrón de respaldo
    'devpm-20260101-0000.db.bak', // no coincide
  ]) {
    fs.writeFileSync(path.join(out, name), 'x');
  }
  const result = backupDatabase({ db, dir: out, retentionDays: 14, now: NOW });
  assert.deepEqual(result.removed.sort(), [
    'devpm-20260101-0000.db',
    'devpm-20260428-2359-2.db',
    'devpm-20260428-2359.db',
  ]);
  assert.deepEqual(names(out), [
    'devpm-20260101-0000.db.bak',
    'devpm-20260429-1504.db',
    'devpm-20260510-0900.db',
    'devpm-20260513-1504.db',
    'devpm.db',
    'notas.txt',
  ]);
  db.close();
});

test('la retención se configura: con 1 día solo queda lo de las últimas 24 horas', () => {
  const dir = tmp();
  const db = fileDb(dir);
  const out = path.join(dir, 'b');
  fs.mkdirSync(out);
  for (const name of ['devpm-20260512-1600.db', 'devpm-20260512-1400.db'])
    fs.writeFileSync(path.join(out, name), 'x');
  backupDatabase({ db, dir: out, retentionDays: 1, now: NOW });
  assert.deepEqual(names(out), ['devpm-20260512-1600.db', 'devpm-20260513-1504.db']);
  db.close();
});

test('un respaldo recién hecho nunca se elimina por retención, aunque sea muy corta', () => {
  const dir = tmp();
  const db = fileDb(dir);
  const result = backupDatabase({ db, dir: path.join(dir, 'b'), retentionDays: 1, now: NOW });
  assert.equal(fs.existsSync(result.file), true);
  assert.deepEqual(result.removed, []);
  db.close();
});

test('si la copia falla la verificación de integridad se elimina y se informa el error', () => {
  const dir = tmp();
  const db = fileDb(dir);
  assert.throws(
    () =>
      backupDatabase({
        db,
        dir: path.join(dir, 'b'),
        retentionDays: 14,
        now: NOW,
        verify: () => 'corrupta',
      }),
    /integridad/,
  );
  assert.deepEqual(fs.existsSync(path.join(dir, 'b')) ? names(path.join(dir, 'b')) : [], []);
  db.close();
});

test('configuración: BACKUP_DIR (por defecto data/backups) y BACKUP_RETENTION_DAYS', () => {
  const base = { NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(40) };
  const config = loadConfig(base);
  assert.equal(config.backupDir, 'data/backups');
  assert.equal(config.backupRetentionDays, 14);
  const custom = loadConfig({
    ...base,
    BACKUP_DIR: '/var/backups/devpm',
    BACKUP_RETENTION_DAYS: '30',
  });
  assert.equal(custom.backupDir, '/var/backups/devpm');
  assert.equal(custom.backupRetentionDays, 30);
  assert.throws(() => loadConfig({ ...base, BACKUP_RETENTION_DAYS: '0' }), /BACKUP_RETENTION_DAYS/);
});

test('CLI scripts/backup-db.js: respalda, informa el archivo y aplica la retención', () => {
  const dir = tmp();
  fileDb(dir).close();
  const out = path.join(dir, 'respaldos');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'devpm-20200101-0000.db'), 'viejo');
  const run = () =>
    spawnSync(process.execPath, ['scripts/backup-db.js'], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SESSION_SECRET: 'x'.repeat(40),
        DATABASE_PATH: path.join(dir, 'devpm.db'),
        BACKUP_DIR: out,
        BACKUP_RETENTION_DAYS: '7',
      },
      encoding: 'utf8',
    });
  const res = run();
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Respaldo creado: .*devpm-\d{8}-\d{4}\.db/);
  assert.match(res.stdout, /Eliminados por retención: 1/);
  assert.equal(fs.existsSync(path.join(out, 'devpm-20200101-0000.db')), false);
  assert.equal(names(out).filter((n) => n.startsWith('devpm-2')).length, 1);
});

test('CLI: sin base de datos existente falla con código 1 y sin crear una vacía', () => {
  const dir = tmp();
  const res = spawnSync(process.execPath, ['scripts/backup-db.js'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'x'.repeat(40),
      DATABASE_PATH: path.join(dir, 'no-existe.db'),
      BACKUP_DIR: path.join(dir, 'b'),
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no existe/i);
  assert.equal(fs.existsSync(path.join(dir, 'no-existe.db')), false);
});

test(
  'el respaldo y su carpeta son privados (contienen hashes de contraseña): 0600 y 0700',
  { skip: process.platform === 'win32' },
  () => {
    const dir = tmp();
    const db = fileDb(dir);
    const backups = path.join(dir, 'backups');
    fs.mkdirSync(backups, { mode: 0o755 }); // carpeta preexistente y abierta
    const result = backupDatabase({ db, dir: backups, retentionDays: 14, now: NOW });
    assert.equal(fs.statSync(result.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(backups).mode & 0o777, 0o700);
    db.close();
  },
);
