import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  const id = user(db, {
    email: 'ana@test.local',
    password_hash: hash,
    full_name: 'Ana',
    role: 'pm',
  });
  return { db, id, app: buildTestApp({ db }) };
}
const sid = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('devpm.sid='));

test('GET /login muestra el formulario', async () => {
  const res = await request(setup().app).get('/login');
  assert.equal(res.status, 200);
  assert.match(res.text, /<form method="post" action="\/login"/);
});

test('login correcto: redirige, guarda la sesión y registra last_login_at', async () => {
  const { app, db, id } = setup();
  const agent = request.agent(app);
  const res = await agent
    .post('/login')
    .type('form')
    .send({ email: 'ANA@test.local', password: PASSWORD });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
  assert.ok(sid(res));
  assert.ok(db.prepare('SELECT last_login_at FROM users WHERE id = ?').pluck().get(id));
  const home = await agent.get('/');
  assert.match(home.text, /Ana/);
  assert.match(home.text, /action="\/logout"/);
});

test('contraseña incorrecta, correo inexistente y usuario inactivo: mismo 401 genérico', async () => {
  const { app, db } = setup();
  user(db, { email: 'off@test.local', password_hash: hash, is_active: 0 });
  for (const body of [
    { email: 'ana@test.local', password: 'incorrecta' },
    { email: 'nadie@test.local', password: PASSWORD },
    { email: 'off@test.local', password: PASSWORD },
  ]) {
    const res = await request(app).post('/login').type('form').send(body);
    assert.equal(res.status, 401);
    assert.match(res.text, /Correo o contraseña incorrectos/);
    assert.equal(sid(res), undefined);
  }
});

test('login con campos vacíos responde 400', async () => {
  const res = await request(setup().app)
    .post('/login')
    .type('form')
    .send({ email: '', password: '' });
  assert.equal(res.status, 400);
});

test('logout destruye la sesión y limpia la cookie', async () => {
  const { app, db } = setup();
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'ana@test.local', password: PASSWORD });
  assert.equal(db.prepare('SELECT count(*) FROM sessions').pluck().get(), 1);
  const res = await agent.post('/logout');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
  assert.equal(db.prepare('SELECT count(*) FROM sessions').pluck().get(), 0);
  assert.doesNotMatch((await agent.get('/')).text, /action="\/logout"/);
});

test('rate limit: tras 10 intentos fallidos /login responde 429 aun con credenciales válidas', async () => {
  const { app } = setup();
  const bad = { email: 'ana@test.local', password: 'incorrecta' };
  for (let i = 0; i < 10; i++) {
    assert.equal((await request(app).post('/login').type('form').send(bad)).status, 401);
  }
  const blocked = await request(app).post('/login').type('form').send(bad);
  assert.equal(blocked.status, 429);
  assert.match(blocked.text, /Demasiados intentos/);
  const valid = await request(app)
    .post('/login')
    .type('form')
    .send({ email: 'ana@test.local', password: PASSWORD });
  assert.equal(valid.status, 429);
});

test('rate limit: los logins correctos no consumen cupo', async () => {
  const { app } = setup();
  for (let i = 0; i < 12; i++) {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'ana@test.local', password: PASSWORD });
    assert.equal(res.status, 302);
  }
});
