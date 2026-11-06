import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user } from '../helpers/factories.js';

// PRD §8.6: un viewer no puede crear ni modificar información (403 en API, controles ocultos en UI).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
const ROLES = ['admin', 'pm', 'developer', 'viewer'];

function setup() {
  const db = createTestDb();
  for (const role of ROLES) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role, full_name: role });
  }
  return { db, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  const res = await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  assert.equal(res.status, 302);
  return agent;
}

const WRITES = [
  [
    'post',
    '/api/v1/users',
    { email: 'x@test.local', fullName: 'X', role: 'viewer', password: 'password-1' },
  ],
  ['patch', '/api/v1/users/1', { fullName: 'Otro' }],
  ['delete', '/api/v1/users/1'],
];

for (const role of ['pm', 'developer', 'viewer']) {
  test(`${role}: 403 en toda la API de usuarios (lectura y escritura)`, async () => {
    const { app, db } = setup();
    const agent = await loginAs(app, role);
    assert.equal((await agent.get('/api/v1/users')).status, 403);
    assert.equal((await agent.get('/api/v1/users/1')).status, 403);
    for (const [method, url, body] of WRITES) {
      const res = await agent[method](url).send(body);
      assert.equal(res.status, 403, `${method.toUpperCase()} ${url}`);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
    assert.equal(db.prepare('SELECT count(*) FROM users').pluck().get(), 4);
    assert.equal(db.prepare('SELECT full_name FROM users WHERE id = 1').pluck().get(), 'admin');
  });

  test(`${role}: 403 en las vistas de administración`, async () => {
    const { app } = setup();
    const agent = await loginAs(app, role);
    for (const url of ['/admin/users', '/admin/users/new', '/admin/users/1']) {
      assert.equal((await agent.get(url)).status, 403, url);
    }
    const post = await agent.post('/admin/users').type('form').send({ email: 'x@test.local' });
    assert.equal(post.status, 403);
  });
}

test('sin sesión: 401 en la API y redirección a /login en las vistas', async () => {
  const { app } = setup();
  for (const [method, url, body] of WRITES) {
    assert.equal((await request(app)[method](url).send(body)).status, 401, url);
  }
  const view = await request(app).get('/admin/users');
  assert.equal(view.status, 302);
  assert.equal(view.headers.location, '/login');
  assert.equal((await request(app).patch('/api/v1/me/password').send({})).status, 401);
});

test('UI: el enlace «Usuarios» solo aparece para admin', async () => {
  const { app } = setup();
  for (const role of ROLES) {
    const res = await (await loginAs(app, role)).get('/');
    assert.equal(res.status, 200);
    assert.equal(res.text.includes('href="/admin/users"'), role === 'admin', role);
  }
});

test('usuario desactivado: no inicia sesión aunque la contraseña sea correcta', async () => {
  const { app, db } = setup();
  db.prepare("UPDATE users SET is_active = 0 WHERE email = 'viewer@test.local'").run();
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ email: 'viewer@test.local', password: PASSWORD });
  assert.equal(res.status, 401);
});
