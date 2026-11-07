import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp, testConfig } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user } from '../helpers/factories.js';

// Endurecimiento de seguridad (Etapa 14): registro de intentos, límite por cuenta, contraseñas,
// Sec-Fetch-Site y sesiones con hash.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function recorder() {
  const lines = [];
  const logger = {
    warn: (obj, msg) => lines.push({ ...obj, msg }),
    info() {},
    error() {},
  };
  return { logger, lines };
}
const bad = (agent, email = 'admin@test.local', password = 'incorrecta1') =>
  agent.post('/login').type('form').send({ email, password });

const from = (app, ip, email) =>
  request(app)
    .post('/login')
    .set('X-Forwarded-For', ip)
    .type('form')
    .send({ email, password: 'incorrecta1' });

function setup({ loginMaxAttempts = 10 } = {}) {
  const db = createTestDb();
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  user(db, { email: 'otro@test.local', password_hash: hash, role: 'viewer' });
  const { logger, lines } = recorder();
  const config = testConfig({ LOGIN_MAX_ATTEMPTS: String(loginMaxAttempts) });
  const app = buildTestApp({ db, logger, config });
  return { db, app, lines };
}

test('un inicio de sesión fallido queda en el log con IP y correo, sin la contraseña', async () => {
  const { app, lines } = setup();
  await bad(request(app), 'admin@test.local', 'clave-secreta-mala');
  const entry = lines.find((l) => l.event === 'login.failed');
  assert.ok(entry, 'se registra login.failed');
  assert.equal(entry.email, 'admin@test.local');
  assert.ok(entry.ip);
  assert.doesNotMatch(JSON.stringify(lines), /clave-secreta-mala/);
});

test('un inicio de sesión correcto no se registra como fallido', async () => {
  const { app, lines } = setup();
  await bad(request(app), 'admin@test.local', PASSWORD);
  assert.equal(lines.filter((l) => l.event === 'login.failed').length, 0);
});

test('límite por IP: al pasar LOGIN_MAX_ATTEMPTS fallos se bloquea y queda registrado', async () => {
  const { app, lines } = setup({ loginMaxAttempts: 3 });
  const agent = request(app);
  for (let i = 0; i < 3; i += 1) assert.equal((await bad(agent, `x${i}@test.local`)).status, 401);
  assert.equal((await bad(agent, 'nuevo@test.local')).status, 429);
  assert.ok(lines.some((l) => l.event === 'login.blocked' && l.scope === 'ip'));
});

test('límite por cuenta: con cada intento desde otra IP, el correo se bloquea al pasar el doble del límite', async () => {
  const { app, lines } = setup({ loginMaxAttempts: 2 });
  app.set('trust proxy', 1); // la IP de cada intento viene de X-Forwarded-For
  const attempt = (ip, email) => from(app, ip, email);
  for (let i = 1; i <= 4; i += 1)
    assert.equal((await attempt(`10.0.0.${i}`, 'admin@test.local')).status, 401, `intento ${i}`);
  assert.equal((await attempt('10.0.0.5', 'admin@test.local')).status, 429);
  assert.ok(lines.some((l) => l.event === 'login.blocked' && l.scope === 'cuenta'));
  // otra cuenta, desde otra IP: sigue disponible
  assert.equal((await attempt('10.0.0.6', 'otro@test.local')).status, 401);
});

test('el límite por cuenta ignora mayúsculas y espacios del correo', async () => {
  const { app, lines } = setup({ loginMaxAttempts: 2 });
  app.set('trust proxy', 1);
  const variants = [
    'admin@test.local',
    'ADMIN@test.local',
    ' admin@test.local ',
    'Admin@Test.Local',
  ];
  for (const [i, v] of variants.entries()) await from(app, `10.1.0.${i}`, v);
  const res = await from(app, '10.1.0.9', 'ADMIN@TEST.LOCAL');
  assert.equal(res.status, 429);
  assert.ok(lines.some((l) => l.scope === 'cuenta'));
});

test('contraseñas: se aceptan 72 bytes y se rechazan 73 o más (bcrypt los ignoraría)', async () => {
  const { app } = setup();
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'admin@test.local', password: PASSWORD });
  const create = (password, n) =>
    admin
      .post('/api/v1/users')
      .send({ email: `u${n}@test.local`, fullName: 'Uno', role: 'viewer', password });
  assert.equal((await create('a'.repeat(72), 1)).status, 201);
  const long = await create('a'.repeat(73), 2);
  assert.equal(long.status, 400);
  assert.match(JSON.stringify(long.body), /72 bytes/);
  // 40 caracteres de 2 bytes = 80 bytes
  assert.equal((await create('ñ'.repeat(40), 3)).status, 400);
  assert.equal((await create('ñ'.repeat(36), 4)).status, 201);
});

test('CSRF: una petición que el navegador marca Sec-Fetch-Site cross-site se rechaza aun sin Origin', async () => {
  const { app, db } = setup();
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'admin@test.local', password: PASSWORD });
  const body = { type: 'internal', name: 'Cliente X', department: 'TI' };
  const cross = await admin.post('/api/v1/clients').set('Sec-Fetch-Site', 'cross-site').send(body);
  assert.equal(cross.status, 403);
  assert.equal(
    db.prepare("SELECT count(*) FROM clients WHERE name = 'Cliente X'").pluck().get(),
    0,
  );
  for (const site of ['same-origin', 'same-site', 'none'])
    assert.equal(
      (
        await admin
          .post('/api/v1/clients')
          .set('Sec-Fetch-Site', site)
          .send({ ...body, name: `C ${site}` })
      ).status,
      201,
      site,
    );
  assert.equal(
    (await admin.get('/api/v1/clients').set('Sec-Fetch-Site', 'cross-site')).status,
    200,
  ); // lecturas no
});

test('el ID de sesión del navegador no aparece en la tabla sessions (se guarda con hash)', async () => {
  const { app, db } = setup();
  const agent = request.agent(app);
  const res = await agent
    .post('/login')
    .type('form')
    .send({ email: 'admin@test.local', password: PASSWORD });
  const cookie = decodeURIComponent(res.headers['set-cookie'][0].split(';')[0].split('=')[1]);
  const sid = cookie.slice(2).split('.')[0]; // «s:<sid>.<firma>»
  const stored = db.prepare('SELECT sid FROM sessions').pluck().all();
  assert.equal(stored.length, 1);
  assert.ok(!stored.includes(sid));
  assert.equal((await agent.get('/api/v1/clients')).status, 200); // y la sesión sigue funcionando
});
