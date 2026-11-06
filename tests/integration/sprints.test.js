import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, project, sprint, task } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  return { db, pid, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const url = (pid) => `/api/v1/projects/${pid}/sprints`;
const sp = (o = {}) => ({
  name: 'Sprint 1',
  goal: 'MVP',
  startDate: '2026-02-02',
  endDate: '2026-02-13',
  ...o,
});

test('sprints: 401 sin sesión; leen todos; escriben solo admin y pm', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid });
  assert.equal((await request(app).get(url(pid))).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.get(url(pid))).status, 200, role);
    assert.equal((await a.get(`/api/v1/sprints/${sid}`)).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post(url(pid)).send(sp())).status, 403, role);
    assert.equal((await a.patch(`/api/v1/sprints/${sid}`).send({ name: 'x' })).status, 403, role);
    assert.equal((await a.delete(`/api/v1/sprints/${sid}`)).status, 403, role);
    assert.equal((await a.post(`/api/v1/sprints/${sid}/start`).send({})).status, 403, role);
    assert.equal((await a.post(`/api/v1/sprints/${sid}/close`).send({})).status, 403, role);
  }
});

test('crear sprint: 201 planned, sin puntos fijados y con bitácora; listado por fecha', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(url(pid)).send(sp());
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, 'planned');
  assert.equal(res.body.data.committedPoints, null);
  assert.equal(res.body.data.completedPoints, null);
  await pm
    .post(url(pid))
    .send(sp({ name: 'Sprint 0', startDate: '2026-01-12', endDate: '2026-01-23' }));
  const list = await pm.get(url(pid));
  assert.deepEqual(
    list.body.data.map((s) => s.name),
    ['Sprint 0', 'Sprint 1'],
  );
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'sprint'").pluck().get(),
    2,
  );
});

test('validación y reglas de fechas de sprints', async () => {
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  for (const b of [
    sp({ name: ' ' }),
    sp({ startDate: '2026-02-30' }),
    sp({ startDate: '2026-02-13', endDate: '2026-02-02' }),
    sp({ status: 'active' }),
    sp({ extra: 1 }),
  ]) {
    assert.equal((await pm.post(url(pid)).send(b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await pm.post(url(9999)).send(sp())).status, 404);
  // fuera del proyecto
  assert.equal((await pm.post(url(pid)).send(sp({ startDate: '2025-12-29' }))).status, 422);
  assert.equal((await pm.post(url(pid)).send(sp({ endDate: '2027-01-08' }))).status, 422);
  // traslape con otro sprint del proyecto (inclusivo)
  assert.equal((await pm.post(url(pid)).send(sp())).status, 201);
  assert.equal(
    (
      await pm
        .post(url(pid))
        .send(sp({ name: 'X', startDate: '2026-02-13', endDate: '2026-02-20' }))
    ).status,
    422,
  );
  assert.equal(
    (
      await pm
        .post(url(pid))
        .send(sp({ name: 'Y', startDate: '2026-02-14', endDate: '2026-02-20' }))
    ).status,
    201,
  );
});

test('editar sprint: parcial, revalida fechas, no edita closed; vacío o status 400', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const id = (await pm.post(url(pid)).send(sp())).body.data.id;
  const res = await pm
    .patch(`/api/v1/sprints/${id}`)
    .send({ name: 'Sprint 1 (ajustado)', goal: null, endDate: '2026-02-20' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'Sprint 1 (ajustado)');
  assert.equal(res.body.data.goal, null);
  assert.equal(
    (await pm.patch(`/api/v1/sprints/${id}`).send({ endDate: '2026-02-01' })).status,
    400,
  );
  assert.equal(
    (await pm.patch(`/api/v1/sprints/${id}`).send({ endDate: '2027-02-01' })).status,
    422,
  );
  assert.equal((await pm.patch(`/api/v1/sprints/${id}`).send({})).status, 400);
  assert.equal((await pm.patch(`/api/v1/sprints/${id}`).send({ status: 'closed' })).status, 400);
  assert.equal((await pm.patch('/api/v1/sprints/9999').send({ name: 'x' })).status, 404);
  const closed = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-05-04',
    end_date: '2026-05-15',
  });
  assert.equal((await pm.patch(`/api/v1/sprints/${closed}`).send({ name: 'x' })).status, 422);
});

test('iniciar: planned → active fija committed_points con puntos de tareas (padre y subtareas)', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid });
  const parent = task(db, { project_id: pid, sprint_id: sid, story_points: 5 });
  task(db, { project_id: pid, sprint_id: sid, story_points: 3, parent_task_id: parent });
  task(db, { project_id: pid, sprint_id: sid, story_points: null });
  task(db, { project_id: pid, story_points: 13 }); // backlog, no cuenta
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(`/api/v1/sprints/${sid}/start`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'active');
  assert.equal(res.body.data.committedPoints, 8);
  const audit = db
    .prepare("SELECT action FROM audit_log WHERE entity = 'sprint' AND entity_id = ?")
    .pluck()
    .get(sid);
  assert.equal(audit, 'status_change');
});

test('iniciar: solo desde planned y solo un sprint activo por proyecto', async () => {
  const { app, db, pid } = setup();
  const a = sprint(db, { project_id: pid, start_date: '2026-02-02', end_date: '2026-02-13' });
  const b = sprint(db, { project_id: pid, start_date: '2026-02-16', end_date: '2026-02-27' });
  const other = sprint(db, { project_id: project(db) });
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.post(`/api/v1/sprints/${a}/start`).send({})).status, 200);
  const second = await pm.post(`/api/v1/sprints/${b}/start`).send({});
  assert.equal(second.status, 422);
  assert.equal(second.body.error.code, 'BUSINESS_RULE');
  assert.equal((await pm.post(`/api/v1/sprints/${a}/start`).send({})).status, 422); // ya activo
  assert.equal((await pm.post(`/api/v1/sprints/${other}/start`).send({})).status, 200); // otro proyecto
  assert.equal((await pm.post('/api/v1/sprints/9999/start').send({})).status, 404);
});

test('cerrar: completed_points = puntos done; no terminadas van al backlog (status backlog) por defecto', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid, status: 'active', committed_points: 11 });
  const done = task(db, { project_id: pid, sprint_id: sid, story_points: 8, status: 'done' });
  const wip = task(db, { project_id: pid, sprint_id: sid, story_points: 3, status: 'in_progress' });
  const todo = task(db, { project_id: pid, sprint_id: sid, status: 'todo' });
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(`/api/v1/sprints/${sid}/close`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'closed');
  assert.equal(res.body.data.completedPoints, 8);
  assert.equal(res.body.data.committedPoints, 11);
  const row = (id) => db.prepare('SELECT sprint_id, status FROM tasks WHERE id = ?').get(id);
  assert.deepEqual({ ...row(done) }, { sprint_id: sid, status: 'done' });
  assert.deepEqual({ ...row(wip) }, { sprint_id: null, status: 'backlog' });
  assert.deepEqual({ ...row(todo) }, { sprint_id: null, status: 'backlog' });
  // el movimiento queda en el historial de estados
  const hist = db
    .prepare('SELECT from_status, to_status FROM task_status_history WHERE task_id = ?')
    .get(wip);
  assert.deepEqual({ ...hist }, { from_status: 'in_progress', to_status: 'backlog' });
});

test('cerrar con moveTo: las no terminadas pasan a otro sprint planned del mismo proyecto', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-02-02',
    end_date: '2026-02-13',
  });
  const next = sprint(db, { project_id: pid, start_date: '2026-02-16', end_date: '2026-02-27' });
  const wip = task(db, { project_id: pid, sprint_id: sid, status: 'in_progress' });
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(`/api/v1/sprints/${sid}/close`).send({ moveTo: next });
  assert.equal(res.status, 200);
  assert.deepEqual(
    { ...db.prepare('SELECT sprint_id, status FROM tasks WHERE id = ?').get(wip) },
    { sprint_id: next, status: 'in_progress' },
  );
});

test('cerrar: solo desde active; moveTo inválido (otro proyecto, no planned, inexistente) 422', async () => {
  const { app, db, pid } = setup();
  const planned = sprint(db, { project_id: pid, start_date: '2026-03-02', end_date: '2026-03-13' });
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-02-02',
    end_date: '2026-02-13',
  });
  const closed = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-01-12',
    end_date: '2026-01-23',
  });
  const foreign = sprint(db, { project_id: project(db) });
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.post(`/api/v1/sprints/${planned}/close`).send({})).status, 422);
  assert.equal((await pm.post(`/api/v1/sprints/${closed}/close`).send({})).status, 422);
  for (const moveTo of [foreign, closed, sid, 9999]) {
    assert.equal(
      (await pm.post(`/api/v1/sprints/${sid}/close`).send({ moveTo })).status,
      422,
      String(moveTo),
    );
  }
  assert.equal(
    (await pm.post(`/api/v1/sprints/${sid}/close`).send({ moveTo: 'backlog' })).status,
    400,
  );
  assert.equal((await pm.post(`/api/v1/sprints/${sid}/close`).send({ moveTo: null })).status, 200);
});

test('eliminar: solo sprints planned sin tareas', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const empty = sprint(db, { project_id: pid, start_date: '2026-03-02', end_date: '2026-03-13' });
  const withTasks = sprint(db, {
    project_id: pid,
    start_date: '2026-04-06',
    end_date: '2026-04-17',
  });
  task(db, { project_id: pid, sprint_id: withTasks });
  const active = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-02-02',
    end_date: '2026-02-13',
  });
  assert.equal((await pm.delete(`/api/v1/sprints/${withTasks}`)).status, 422);
  assert.equal((await pm.delete(`/api/v1/sprints/${active}`)).status, 422);
  assert.equal((await pm.delete(`/api/v1/sprints/${empty}`)).status, 204);
  assert.equal((await pm.delete(`/api/v1/sprints/${empty}`)).status, 404);
});

test('detalle incluye conteo de tareas y puntos actuales', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid });
  task(db, { project_id: pid, sprint_id: sid, story_points: 5, status: 'done' });
  task(db, { project_id: pid, sprint_id: sid, story_points: 3 });
  const res = await (await loginAs(app, 'viewer')).get(`/api/v1/sprints/${sid}`);
  assert.equal(res.body.data.taskCount, 2);
  assert.equal(res.body.data.totalPoints, 8);
  assert.equal(res.body.data.donePoints, 5);
});

test('vistas: /projects/:id/sprints lista y opera por formulario; viewer sin controles', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  assert.equal((await request(app).get(`/projects/${pid}/sprints`)).status, 302);
  const add = await pm
    .post(`/projects/${pid}/sprints`)
    .type('form')
    .send({ name: 'Sprint 1', goal: '', startDate: '2026-02-02', endDate: '2026-02-13' });
  assert.equal(add.status, 302);
  assert.equal(add.headers.location, `/projects/${pid}/sprints`);
  const sid = db.prepare('SELECT id FROM sprints').pluck().get();
  const bad = await pm
    .post(`/projects/${pid}/sprints`)
    .type('form')
    .send({ name: 'Mal', startDate: '2025-01-01', endDate: '2025-01-10' });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /<form/);

  const page = await pm.get(`/projects/${pid}/sprints`);
  assert.match(page.text, /Sprint 1/);
  assert.match(page.text, /name="startDate"/);
  const viewer = await (await loginAs(app, 'viewer')).get(`/projects/${pid}/sprints`);
  assert.match(viewer.text, /Sprint 1/);
  assert.doesNotMatch(viewer.text, /name="startDate"/);

  assert.equal(
    (await pm.post(`/projects/${pid}/sprints/${sid}/start`).type('form').send({})).status,
    302,
  );
  assert.equal(db.prepare('SELECT status FROM sprints WHERE id = ?').pluck().get(sid), 'active');
  assert.equal(
    (await pm.post(`/projects/${pid}/sprints/${sid}/close`).type('form').send({ moveTo: '' }))
      .status,
    302,
  );
  assert.equal(db.prepare('SELECT status FROM sprints WHERE id = ?').pluck().get(sid), 'closed');
  const v = await loginAs(app, 'viewer');
  assert.equal((await v.post(`/projects/${pid}/sprints`).type('form').send({})).status, 403);
});
