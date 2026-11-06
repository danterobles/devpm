import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  const adminId = user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  const app = buildTestApp({ db });
  return { db, app, adminId };
}

async function loginAs(app, email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/login').type('form').send({ email, password });
  assert.equal(res.status, 302);
  return agent;
}

const newUser = (o = {}) => ({
  email: 'nuevo@test.local',
  fullName: 'Nuevo Usuario',
  role: 'developer',
  password: 'password-largo',
  ...o,
});

test('API usuarios: sin sesión 401; rol no admin 403', async () => {
  const { app, db } = setup();
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  assert.equal((await request(app).get('/api/v1/users')).status, 401);
  const pm = await loginAs(app, 'pm@test.local');
  assert.equal((await pm.get('/api/v1/users')).status, 403);
  assert.equal((await pm.post('/api/v1/users').send(newUser())).status, 403);
});

test('crear usuario: 201, sin password_hash en la respuesta, puede iniciar sesión, queda en bitácora', async () => {
  const { app, db, adminId } = setup();
  const admin = await loginAs(app, 'admin@test.local');
  const res = await admin.post('/api/v1/users').send(newUser());
  assert.equal(res.status, 201);
  assert.equal(res.body.data.email, 'nuevo@test.local');
  assert.equal(res.body.data.role, 'developer');
  assert.equal(res.body.data.isActive, true);
  assert.equal(res.body.data.passwordHash, undefined);
  assert.equal(res.body.data.password_hash, undefined);
  await loginAs(app, 'nuevo@test.local', 'password-largo');
  const audit = db.prepare("SELECT user_id, action FROM audit_log WHERE entity = 'user'").get();
  assert.deepEqual({ ...audit }, { user_id: adminId, action: 'create' });
});

test('crear usuario: valida contraseña corta, rol inválido y correo duplicado (case-insensitive)', async () => {
  const { app } = setup();
  const admin = await loginAs(app, 'admin@test.local');
  const short = await admin.post('/api/v1/users').send(newUser({ password: '1234567' }));
  assert.equal(short.status, 400);
  assert.equal(short.body.error.code, 'VALIDATION_ERROR');
  assert.equal((await admin.post('/api/v1/users').send(newUser({ role: 'root' }))).status, 400);
  const dup = await admin.post('/api/v1/users').send(newUser({ email: 'ADMIN@test.local' }));
  assert.equal(dup.status, 409);
});

test('vincular a miembro del equipo (RF-04): existente OK, inexistente 422, ya vinculado 409', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin@test.local');
  const tm = teamMember(db);
  const ok = await admin.post('/api/v1/users').send(newUser({ teamMemberId: tm }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.teamMemberId, tm);
  const dup = await admin
    .post('/api/v1/users')
    .send(newUser({ email: 'otro@test.local', teamMemberId: tm }));
  assert.equal(dup.status, 409);
  const missing = await admin
    .post('/api/v1/users')
    .send(newUser({ email: 'x@test.local', teamMemberId: 9999 }));
  assert.equal(missing.status, 422);
});

test('listar con búsqueda, filtro de estado y paginación', async () => {
  const { app, db } = setup();
  user(db, { email: 'luis@test.local', full_name: 'Luis Gómez', role: 'viewer', is_active: 0 });
  user(db, { email: 'maria@test.local', full_name: 'María Ruiz', role: 'pm' });
  const admin = await loginAs(app, 'admin@test.local');
  const all = await admin.get('/api/v1/users');
  assert.equal(all.body.meta.total, 3);
  const q = await admin.get('/api/v1/users?q=gómez');
  assert.deepEqual(
    q.body.data.map((u) => u.email),
    ['luis@test.local'],
  );
  const inactive = await admin.get('/api/v1/users?status=inactive');
  assert.equal(inactive.body.meta.total, 1);
  const page = await admin.get('/api/v1/users?pageSize=2&page=2');
  assert.equal(page.body.data.length, 1);
  assert.equal(page.body.meta.pageSize, 2);
});

test('detalle: 200 y 404', async () => {
  const { app, adminId } = setup();
  const admin = await loginAs(app, 'admin@test.local');
  assert.equal((await admin.get(`/api/v1/users/${adminId}`)).body.data.email, 'admin@test.local');
  assert.equal((await admin.get('/api/v1/users/9999')).status, 404);
});

test('editar: nombre, rol y contraseña; cambiar rol o contraseña cierra sus sesiones', async () => {
  const { app, db } = setup();
  const uid = user(db, { email: 'dev@test.local', password_hash: hash, role: 'developer' });
  const dev = await loginAs(app, 'dev@test.local');
  assert.equal((await dev.get('/')).status, 200);
  const admin = await loginAs(app, 'admin@test.local');
  const res = await admin
    .patch(`/api/v1/users/${uid}`)
    .send({ fullName: 'Dev Renombrado', role: 'pm', password: 'otra-clave-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.fullName, 'Dev Renombrado');
  assert.equal(res.body.data.role, 'pm');
  assert.equal(db.prepare('SELECT count(*) FROM sessions').pluck().get(), 1); // solo la del admin
  await loginAs(app, 'dev@test.local', 'otra-clave-1');
});

test('desactivar (PATCH isActive=false y DELETE): no puede iniciar sesión y se cierran sus sesiones', async () => {
  const { app, db } = setup();
  const a = user(db, { email: 'a@test.local', password_hash: hash });
  const b = user(db, { email: 'b@test.local', password_hash: hash });
  await loginAs(app, 'a@test.local');
  const admin = await loginAs(app, 'admin@test.local');
  assert.equal((await admin.patch(`/api/v1/users/${a}`).send({ isActive: false })).status, 200);
  assert.equal((await admin.delete(`/api/v1/users/${b}`)).status, 204);
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').pluck().get(b), 0);
  assert.equal(db.prepare('SELECT count(*) FROM users').pluck().get(), 3); // no se borra
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ email: 'a@test.local', password: PASSWORD });
  assert.equal(res.status, 401);
});

test('un admin no puede desactivarse ni quitarse el rol admin a sí mismo (422)', async () => {
  const { app, adminId } = setup();
  const admin = await loginAs(app, 'admin@test.local');
  assert.equal((await admin.delete(`/api/v1/users/${adminId}`)).status, 422);
  assert.equal(
    (await admin.patch(`/api/v1/users/${adminId}`).send({ isActive: false })).status,
    422,
  );
  assert.equal((await admin.patch(`/api/v1/users/${adminId}`).send({ role: 'pm' })).status, 422);
  assert.equal(
    (await admin.patch(`/api/v1/users/${adminId}`).send({ fullName: 'Admin Nuevo' })).status,
    200,
  );
});

test('desvincular con teamMemberId null', async () => {
  const { app, db } = setup();
  const tm = teamMember(db);
  const uid = user(db, { team_member_id: tm });
  const admin = await loginAs(app, 'admin@test.local');
  const res = await admin.patch(`/api/v1/users/${uid}`).send({ teamMemberId: null });
  assert.equal(res.body.data.teamMemberId, null);
});

test('vistas admin: listado y formularios solo para admin', async () => {
  const { app, db } = setup();
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  const pm = await loginAs(app, 'pm@test.local');
  assert.equal((await pm.get('/admin/users')).status, 403);
  assert.equal((await request(app).get('/admin/users')).status, 302);

  const admin = await loginAs(app, 'admin@test.local');
  const list = await admin.get('/admin/users');
  assert.equal(list.status, 200);
  assert.match(list.text, /admin@test\.local/);
  assert.equal((await admin.get('/admin/users/new')).status, 200);
});

test('vistas admin: crear por formulario redirige al listado; error re-muestra el formulario', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin@test.local');
  const ok = await admin.post('/admin/users').type('form').send({
    email: 'form@test.local',
    fullName: 'Desde Form',
    role: 'viewer',
    password: 'clave-larga-1',
    teamMemberId: '',
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/admin/users');
  assert.ok(db.prepare("SELECT 1 FROM users WHERE email = 'form@test.local'").get());

  const bad = await admin
    .post('/admin/users')
    .type('form')
    .send({ email: 'form@test.local', fullName: 'Dup', role: 'viewer', password: 'clave-larga-1' });
  assert.equal(bad.status, 409);
  assert.match(bad.text, /<form/);
  assert.match(bad.text, /form@test\.local/);
});

test('vistas admin: editar y desactivar por formulario', async () => {
  const { app, db } = setup();
  const uid = user(db, { email: 'e@test.local', full_name: 'Antes', role: 'viewer' });
  const admin = await loginAs(app, 'admin@test.local');
  assert.match((await admin.get(`/admin/users/${uid}`)).text, /Antes/);
  const edit = await admin
    .post(`/admin/users/${uid}`)
    .type('form')
    .send({ fullName: 'Después', role: 'pm', isActive: '1', password: '', teamMemberId: '' });
  assert.equal(edit.status, 302);
  assert.equal(db.prepare('SELECT full_name FROM users WHERE id = ?').pluck().get(uid), 'Después');
  const off = await admin
    .post(`/admin/users/${uid}`)
    .type('form')
    .send({ fullName: 'Después', role: 'pm', password: '', teamMemberId: '' });
  assert.equal(off.status, 302);
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').pluck().get(uid), 0);
});
