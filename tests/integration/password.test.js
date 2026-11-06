import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const NEW = 'nueva-clave-99';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup(role = 'viewer') {
  const db = createTestDb();
  const id = user(db, { email: 'u@test.local', password_hash: hash, role });
  return { db, id, app: buildTestApp({ db }) };
}
async function login(app) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'u@test.local', password: PASSWORD });
  return agent;
}

test('cambio de contraseña: sin sesión se rechaza', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/account/password')).status, 302);
  const api = await request(app).patch('/api/v1/me/password').send({});
  assert.equal(api.status, 401);
});

test('cualquier rol ve el formulario', async () => {
  const { app } = setup('viewer');
  const agent = await login(app);
  const res = await agent.get('/account/password');
  assert.equal(res.status, 200);
  assert.match(res.text, /name="currentPassword"/);
});

test('API: cambia la contraseña con la actual correcta; la sesión actual sigue y las demás se cierran', async () => {
  const { app, db, id } = setup();
  const other = await login(app);
  const agent = await login(app);
  const res = await agent
    .patch('/api/v1/me/password')
    .send({ currentPassword: PASSWORD, newPassword: NEW });
  assert.equal(res.status, 204);
  assert.equal((await agent.get('/account/password')).status, 200);
  assert.equal((await other.get('/account/password')).status, 302);
  assert.ok(
    bcrypt.compareSync(
      NEW,
      db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(id),
    ),
  );
  const relog = await request(app)
    .post('/login')
    .type('form')
    .send({ email: 'u@test.local', password: NEW });
  assert.equal(relog.status, 302);
  const audit = db.prepare("SELECT user_id, action FROM audit_log WHERE entity = 'user'").get();
  assert.deepEqual({ ...audit }, { user_id: id, action: 'update' });
});

test('API: contraseña actual incorrecta 422; nueva corta 400; nueva igual a la actual 422', async () => {
  const { app } = setup();
  const agent = await login(app);
  const bad = await agent
    .patch('/api/v1/me/password')
    .send({ currentPassword: 'mala-mala-1', newPassword: NEW });
  assert.equal(bad.status, 422);
  const short = await agent
    .patch('/api/v1/me/password')
    .send({ currentPassword: PASSWORD, newPassword: '1234567' });
  assert.equal(short.status, 400);
  const same = await agent
    .patch('/api/v1/me/password')
    .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
  assert.equal(same.status, 422);
});

test('formulario HTML: éxito redirige; confirmación distinta o error re-muestra el formulario', async () => {
  const { app, db, id } = setup();
  const agent = await login(app);
  const mismatch = await agent
    .post('/account/password')
    .type('form')
    .send({ currentPassword: PASSWORD, newPassword: NEW, confirmPassword: 'otra-distinta' });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.text, /<form/);
  const wrong = await agent
    .post('/account/password')
    .type('form')
    .send({ currentPassword: 'incorrecta-1', newPassword: NEW, confirmPassword: NEW });
  assert.equal(wrong.status, 422);
  const ok = await agent
    .post('/account/password')
    .type('form')
    .send({ currentPassword: PASSWORD, newPassword: NEW, confirmPassword: NEW });
  assert.equal(ok.status, 302);
  assert.ok(
    bcrypt.compareSync(
      NEW,
      db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(id),
    ),
  );
});
