import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, project } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  return { db, pid: project(db), app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const url = (pid) => `/api/v1/projects/${pid}/milestones`;
const ms = (o = {}) => ({ name: 'Entrega beta', dueDate: '2026-05-15', ...o });

afterEach(() => setClock(() => new Date()));

test('hitos: 401 sin sesión; leen todos; escriben solo admin y pm', async () => {
  const { app, pid } = setup();
  assert.equal((await request(app).get(url(pid))).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal((await (await loginAs(app, role)).get(url(pid))).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post(url(pid)).send(ms())).status, 403, role);
    assert.equal((await a.patch(`${url(pid)}/1`).send({ name: 'x' })).status, 403, role);
    assert.equal((await a.delete(`${url(pid)}/1`)).status, 403, role);
  }
});

test('crear hito: 201, estado pending, bitácora; listado ordenado por fecha', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(url(pid)).send(ms({ description: 'Versión beta' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(res.body.data.completedAt, null);
  assert.equal(res.body.data.description, 'Versión beta');
  await pm.post(url(pid)).send(ms({ name: 'Kick-off', dueDate: '2026-03-02' }));
  const list = await pm.get(url(pid));
  assert.deepEqual(
    list.body.data.map((m) => m.name),
    ['Kick-off', 'Entrega beta'],
  );
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'milestone'").pluck().get(),
    2,
  );
});

test('validación de hitos y proyecto inexistente', async () => {
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  for (const b of [
    ms({ name: ' ' }),
    ms({ dueDate: '2026-02-30' }),
    ms({ dueDate: undefined }),
    ms({ status: 'completed' }),
    ms({ extra: 1 }),
  ]) {
    assert.equal((await pm.post(url(pid)).send(b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await pm.post(url(9999)).send(ms())).status, 404);
  assert.equal((await pm.get(url(9999))).status, 404);
});

test('completar guarda completed_at; reabrir lo limpia; missed no lo fija', async () => {
  setClock(() => new Date('2026-05-16T10:00:00.000Z'));
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const id = (await pm.post(url(pid)).send(ms())).body.data.id;
  const done = await pm.patch(`${url(pid)}/${id}`).send({ status: 'completed' });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.completedAt, '2026-05-16T10:00:00.000Z');
  const reopened = await pm.patch(`${url(pid)}/${id}`).send({ status: 'pending' });
  assert.equal(reopened.body.data.completedAt, null);
  const missed = await pm.patch(`${url(pid)}/${id}`).send({ status: 'missed' });
  assert.equal(missed.body.data.status, 'missed');
  assert.equal(missed.body.data.completedAt, null);
});

test('editar parcial; vacío o estado inválido 400; 404 si no es de ese proyecto', async () => {
  const { app, db, pid } = setup();
  const other = project(db);
  const pm = await loginAs(app, 'pm');
  const id = (await pm.post(url(pid)).send(ms())).body.data.id;
  const res = await pm
    .patch(`${url(pid)}/${id}`)
    .send({ name: 'Entrega final', dueDate: '2026-06-01', description: null });
  assert.equal(res.body.data.name, 'Entrega final');
  assert.equal(res.body.data.dueDate, '2026-06-01');
  assert.equal(res.body.data.description, null);
  assert.equal((await pm.patch(`${url(pid)}/${id}`).send({})).status, 400);
  assert.equal((await pm.patch(`${url(pid)}/${id}`).send({ status: 'raro' })).status, 400);
  assert.equal((await pm.patch(`${url(other)}/${id}`).send({ name: 'x' })).status, 404);
  assert.equal((await pm.patch(`${url(pid)}/9999`).send({ name: 'x' })).status, 404);
});

test('eliminar hito: 204 y 404; no afecta hitos de otro proyecto', async () => {
  const { app, db, pid } = setup();
  const other = project(db);
  const pm = await loginAs(app, 'pm');
  const a = (await pm.post(url(pid)).send(ms())).body.data.id;
  const b = (await pm.post(url(other)).send(ms())).body.data.id;
  assert.equal((await pm.delete(`${url(pid)}/${b}`)).status, 404);
  assert.equal((await pm.delete(`${url(pid)}/${a}`)).status, 204);
  assert.equal((await pm.delete(`${url(pid)}/${a}`)).status, 404);
  assert.equal(db.prepare('SELECT count(*) FROM milestones').pluck().get(), 1);
});

test('ficha del proyecto: lista hitos, controles por rol y operaciones por formulario', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const add = await pm
    .post(`/projects/${pid}/milestones`)
    .type('form')
    .send({ name: 'Entrega beta', dueDate: '2026-05-15', description: '' });
  assert.equal(add.status, 302);
  assert.equal(add.headers.location, `/projects/${pid}`);
  const id = db.prepare('SELECT id FROM milestones').pluck().get();
  const asPm = await pm.get(`/projects/${pid}`);
  assert.match(asPm.text, /Entrega beta/);
  assert.match(asPm.text, /name="dueDate"/);
  const viewer = await (await loginAs(app, 'viewer')).get(`/projects/${pid}`);
  assert.match(viewer.text, /Entrega beta/);
  assert.doesNotMatch(viewer.text, /name="dueDate"/);

  const bad = await pm
    .post(`/projects/${pid}/milestones`)
    .type('form')
    .send({ name: '', dueDate: '2026-05-15' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);

  const st = await pm
    .post(`/projects/${pid}/milestones/${id}/status`)
    .type('form')
    .send({ status: 'completed' });
  assert.equal(st.status, 302);
  assert.equal(
    db.prepare('SELECT status FROM milestones WHERE id = ?').pluck().get(id),
    'completed',
  );
  const del = await pm.post(`/projects/${pid}/milestones/${id}/delete`).type('form').send({});
  assert.equal(del.status, 302);
  assert.equal(db.prepare('SELECT count(*) FROM milestones').pluck().get(), 0);
  const v = await loginAs(app, 'viewer');
  assert.equal((await v.post(`/projects/${pid}/milestones`).type('form').send({})).status, 403);
});
