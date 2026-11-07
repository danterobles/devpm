import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';

// Alta del primer administrador en producción (el seed solo existe en desarrollo).
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpm-admin-'));
  dirs.push(dir);
  const file = path.join(dir, 'devpm.db');
  const db = openDb(file);
  migrate(db);
  db.close();
  return file;
}
const run = (file, args, env = {}) =>
  spawnSync(process.execPath, ['scripts/create-admin.js', ...args], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'p'.repeat(40),
      DATABASE_PATH: file,
      ...env,
    },
    encoding: 'utf8',
  });
const users = (file) => {
  const db = new Database(file, { readonly: true });
  const rows = db
    .prepare('SELECT email, full_name, role, is_active, password_hash FROM users')
    .all();
  db.close();
  return rows;
};

test('crea un administrador activo con la contraseña cifrada (bcrypt costo 12) y lo registra en bitácora', async () => {
  const file = setup();
  const res = run(file, ['--email', 'Admin@Empresa.com', '--name', 'Ana Directora'], {
    ADMIN_PASSWORD: 'clave-segura-1',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Administrador creado: admin@empresa\.com/);
  const [admin] = users(file);
  assert.deepEqual(
    { email: admin.email, name: admin.full_name, role: admin.role, active: admin.is_active },
    { email: 'admin@empresa.com', name: 'Ana Directora', role: 'admin', active: 1 },
  );
  assert.ok(await bcrypt.compare('clave-segura-1', admin.password_hash));
  assert.equal(bcrypt.getRounds(admin.password_hash), 12);
  const db = new Database(file, { readonly: true });
  const audit = db.prepare("SELECT action, user_id FROM audit_log WHERE entity = 'user'").get();
  db.close();
  assert.deepEqual({ ...audit }, { action: 'create', user_id: null });
  assert.doesNotMatch(res.stdout + res.stderr, /clave-segura-1/); // nunca se imprime la contraseña
});

test('la contraseña también puede leerse de la entrada estándar (sin quedar en el historial del shell)', () => {
  const file = setup();
  const res = spawnSync(
    process.execPath,
    ['scripts/create-admin.js', '--email', 'a@b.co', '--name', 'A B'],
    {
      cwd: new URL('../..', import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SESSION_SECRET: 'p'.repeat(40),
        DATABASE_PATH: file,
      },
      input: 'otra-clave-123\n',
      encoding: 'utf8',
    },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(users(file).length, 1);
});

test('valida los datos: correo, nombre y contraseña de al menos 8 caracteres', () => {
  const file = setup();
  const bad = [
    [['--email', 'no-es-correo', '--name', 'Ana'], 'clave-segura-1', /correo/i],
    [['--email', 'a@b.co'], 'clave-segura-1', /nombre/i],
    [['--name', 'Ana'], 'clave-segura-1', /correo/i],
    [['--email', 'a@b.co', '--name', 'Ana'], 'corta', /contraseña/i],
    [['--email', 'a@b.co', '--name', 'Ana'], '', /contraseña/i],
  ];
  for (const [args, password, message] of bad) {
    const res = run(file, args, { ADMIN_PASSWORD: password });
    assert.equal(res.status, 1, args.join(' '));
    assert.match(res.stderr, message);
  }
  assert.equal(users(file).length, 0);
});

test('rechaza un correo ya registrado (sin distinguir mayúsculas) y no modifica al existente', () => {
  const file = setup();
  assert.equal(
    run(file, ['--email', 'a@b.co', '--name', 'Ana'], { ADMIN_PASSWORD: 'clave-segura-1' }).status,
    0,
  );
  const again = run(file, ['--email', 'A@B.CO', '--name', 'Otra'], {
    ADMIN_PASSWORD: 'distinta-clave-2',
  });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /ya está registrado/);
  assert.equal(users(file).length, 1);
  assert.equal(users(file)[0].full_name, 'Ana');
});

test('falla con claridad si la base no existe o no está migrada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpm-admin-'));
  dirs.push(dir);
  const missing = run(path.join(dir, 'no.db'), ['--email', 'a@b.co', '--name', 'Ana'], {
    ADMIN_PASSWORD: 'clave-segura-1',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no existe/i);
  assert.equal(fs.existsSync(path.join(dir, 'no.db')), false);
  const empty = path.join(dir, 'vacia.db');
  new Database(empty).close();
  const notMigrated = run(empty, ['--email', 'a@b.co', '--name', 'Ana'], {
    ADMIN_PASSWORD: 'clave-segura-1',
  });
  assert.equal(notMigrated.status, 1);
  assert.match(notMigrated.stderr, /db:migrate/);
});

test('el administrador creado puede iniciar sesión en la aplicación', async () => {
  const file = setup();
  run(file, ['--email', 'a@b.co', '--name', 'Ana'], { ADMIN_PASSWORD: 'clave-segura-1' });
  const { default: request } = await import('supertest');
  const { createApp } = await import('../../src/app.js');
  const { loadConfig } = await import('../../src/config/index.js');
  const db = openDb(file);
  const app = createApp({
    config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(40), LOG_LEVEL: 'silent' }),
    db,
  });
  const agent = request.agent(app);
  const login = await agent
    .post('/login')
    .type('form')
    .send({ email: 'a@b.co', password: 'clave-segura-1' });
  assert.equal(login.status, 302);
  assert.equal((await agent.get('/api/v1/users')).status, 200); // es admin
  db.close();
});
