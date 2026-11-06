import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, internalClient, project, task } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  return { db, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const set = (agent, id, body) => agent.post(`/api/v1/projects/${id}/status`).send(body);

afterEach(() => setClock(() => new Date()));

test('permisos: 401 sin sesión; developer y viewer 403', async () => {
  const { app, db } = setup();
  const id = project(db);
  assert.equal(
    (await request(app).post(`/api/v1/projects/${id}/status`).send({ status: 'active' })).status,
    401,
  );
  for (const role of ['developer', 'viewer']) {
    assert.equal((await set(await loginAs(app, role), id, { status: 'active' })).status, 403, role);
  }
});

test('transiciones válidas de la máquina de estados', async () => {
  const valid = [
    ['planning', 'active'],
    ['planning', 'cancelled'],
    ['active', 'completed'],
    ['active', 'on_hold'],
    ['active', 'cancelled'],
    ['on_hold', 'active'],
    ['on_hold', 'cancelled'],
  ];
  for (const [from, to] of valid) {
    const { app, db } = setup();
    const id = project(db, { status: from });
    const res = await set(await loginAs(app, 'pm'), id, { status: to });
    assert.equal(res.status, 200, `${from} → ${to}`);
    assert.equal(res.body.data.status, to);
  }
});

test('transiciones inválidas responden 422 BUSINESS_RULE y no cambian el estado', async () => {
  const invalid = [
    ['planning', 'completed'],
    ['planning', 'on_hold'],
    ['planning', 'planning'],
    ['active', 'planning'],
    ['on_hold', 'completed'],
    ['on_hold', 'planning'],
    ['completed', 'active'],
    ['completed', 'cancelled'],
    ['cancelled', 'active'],
    ['cancelled', 'planning'],
  ];
  for (const [from, to] of invalid) {
    const { app, db } = setup();
    const id = project(db, { status: from });
    const res = await set(await loginAs(app, 'pm'), id, { status: to });
    assert.equal(res.status, 422, `${from} → ${to}`);
    assert.equal(res.body.error.code, 'BUSINESS_RULE');
    assert.equal(db.prepare('SELECT status FROM projects WHERE id = ?').pluck().get(id), from);
  }
});

test('validación: estado desconocido 400, proyecto inexistente 404', async () => {
  const { app, db } = setup();
  const id = project(db);
  const pm = await loginAs(app, 'pm');
  assert.equal((await set(pm, id, { status: 'archivado' })).status, 400);
  assert.equal((await set(pm, id, {})).status, 400);
  assert.equal((await set(pm, id, { status: 'active', extra: 1 })).status, 400);
  assert.equal((await set(pm, 9999, { status: 'active' })).status, 404);
});

test('planning → active fija actual_start_date = hoy solo si es nulo', async () => {
  setClock(() => new Date('2026-05-10T15:00:00Z'));
  const { app, db } = setup();
  const a = project(db, { status: 'planning' });
  const b = project(db, { status: 'planning', actual_start_date: '2026-04-01' });
  const pm = await loginAs(app, 'pm');
  assert.equal((await set(pm, a, { status: 'active' })).body.data.actualStartDate, '2026-05-10');
  assert.equal((await set(pm, b, { status: 'active' })).body.data.actualStartDate, '2026-04-01');
});

test('active → completed fija actual_end_date = hoy', async () => {
  setClock(() => new Date('2026-06-20T15:00:00Z'));
  const { app, db } = setup();
  const id = project(db, { status: 'active' });
  const res = await set(await loginAs(app, 'pm'), id, { status: 'completed' });
  assert.equal(res.body.data.actualEndDate, '2026-06-20');
});

test('completar con tareas abiertas: 422 con conteo, salvo confirmOpenTasks', async () => {
  const { app, db } = setup();
  const id = project(db, { status: 'active' });
  task(db, { project_id: id, status: 'done' });
  task(db, { project_id: id, status: 'in_progress' });
  task(db, { project_id: id, status: 'backlog' });
  const pm = await loginAs(app, 'pm');
  const blocked = await set(pm, id, { status: 'completed' });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error.code, 'BUSINESS_RULE');
  assert.equal(blocked.body.error.details.openTasks, 2);
  assert.match(blocked.body.error.message, /2/);
  assert.equal(db.prepare('SELECT status FROM projects WHERE id = ?').pluck().get(id), 'active');
  const forced = await set(pm, id, { status: 'completed', confirmOpenTasks: true });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.data.status, 'completed');
});

test('completar sin tareas abiertas no exige confirmación; otras transiciones ignoran las tareas', async () => {
  const { app, db } = setup();
  const done = project(db, { status: 'active' });
  task(db, { project_id: done, status: 'done' });
  const open = project(db, { status: 'active' });
  task(db, { project_id: open, status: 'todo' });
  const pm = await loginAs(app, 'pm');
  assert.equal((await set(pm, done, { status: 'completed' })).status, 200);
  assert.equal((await set(pm, open, { status: 'on_hold' })).status, 200);
});

test('la transición queda en bitácora como status_change', async () => {
  const { app, db } = setup();
  const id = project(db);
  await set(await loginAs(app, 'pm'), id, { status: 'active' });
  const row = db
    .prepare("SELECT action, changes FROM audit_log WHERE entity = 'project' AND entity_id = ?")
    .get(id);
  assert.equal(row.action, 'status_change');
  assert.deepEqual(JSON.parse(row.changes).status, ['planning', 'active']);
});

test('el PATCH general sigue sin permitir cambiar el estado', async () => {
  const { app, db } = setup();
  const id = project(db, { client_id: internalClient(db) });
  assert.equal(
    (await (await loginAs(app, 'pm')).patch(`/api/v1/projects/${id}`).send({ status: 'active' }))
      .status,
    400,
  );
});

test('vista: la ficha ofrece solo las transiciones válidas a admin/pm y el formulario las aplica', async () => {
  const { app, db } = setup();
  const id = project(db, { status: 'active' });
  task(db, { project_id: id, status: 'todo' });
  const pm = await loginAs(app, 'pm');
  const page = await pm.get(`/projects/${id}`);
  assert.match(page.text, /name="status" value="on_hold"/);
  assert.match(page.text, /name="status" value="completed"/);
  assert.doesNotMatch(page.text, /name="status" value="planning"/);
  assert.match(page.text, /name="confirmOpenTasks"/);
  const viewer = await (await loginAs(app, 'viewer')).get(`/projects/${id}`);
  assert.doesNotMatch(viewer.text, /name="status" value="on_hold"/);

  const blocked = await pm
    .post(`/projects/${id}/status`)
    .type('form')
    .send({ status: 'completed' });
  assert.equal(blocked.status, 422);
  assert.match(blocked.text, /tareas abiertas/);
  const ok = await pm
    .post(`/projects/${id}/status`)
    .type('form')
    .send({ status: 'completed', confirmOpenTasks: '1' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, `/projects/${id}`);
  assert.equal(db.prepare('SELECT status FROM projects WHERE id = ?').pluck().get(id), 'completed');
  const final = await pm.get(`/projects/${id}`);
  assert.doesNotMatch(final.text, /name="status" value=/);
  assert.equal(
    (
      await (
        await loginAs(app, 'viewer')
      )
        .post(`/projects/${id}/status`)
        .type('form')
        .send({ status: 'active' })
    ).status,
    403,
  );
});
