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
const url = (id) => `/api/v1/tasks/${id}/dependencies`;
const add = (agent, id, dependsOnTaskId) => agent.post(url(id)).send({ dependsOnTaskId });

test('dependencias: 401 sin sesión; leen todos; escriben solo admin y pm', async () => {
  const { app, db, pid } = setup();
  const a = task(db, { project_id: pid });
  const b = task(db, { project_id: pid });
  assert.equal((await request(app).get(url(a))).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal((await (await loginAs(app, role)).get(url(a))).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const ag = await loginAs(app, role);
    assert.equal((await add(ag, b, a)).status, 403, role);
    assert.equal((await ag.delete(`${url(b)}/${a}`)).status, 403, role);
  }
});

test('agregar dependencia fin-a-inicio: 201, aparece en predecesoras y sucesoras, con bitácora', async () => {
  const { app, db, pid } = setup();
  const a = task(db, { project_id: pid, title: 'Diseño' });
  const b = task(db, { project_id: pid, title: 'Implementación' });
  const pm = await loginAs(app, 'pm');
  const res = await add(pm, b, a);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.type, 'FS');
  const deps = await pm.get(url(b));
  assert.deepEqual(
    deps.body.data.predecessors.map((t) => t.title),
    ['Diseño'],
  );
  assert.deepEqual(deps.body.data.successors, []);
  const inverse = await pm.get(url(a));
  assert.deepEqual(
    inverse.body.data.successors.map((t) => t.title),
    ['Implementación'],
  );
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'task_dependency'").pluck().get(),
    1,
  );
});

test('reglas: misma tarea, otro proyecto, inexistente y duplicada', async () => {
  const { app, db, pid } = setup();
  const a = task(db, { project_id: pid });
  const b = task(db, { project_id: pid });
  const foreign = task(db, { project_id: project(db) });
  const pm = await loginAs(app, 'pm');
  assert.equal((await add(pm, a, a)).status, 422);
  assert.equal((await add(pm, a, foreign)).status, 422);
  assert.equal((await add(pm, a, 9999)).status, 422);
  assert.equal((await add(pm, 9999, a)).status, 404);
  assert.equal((await add(pm, b, a)).status, 201);
  const dup = await add(pm, b, a);
  assert.equal(dup.status, 409);
  assert.equal((await pm.post(url(b)).send({})).status, 400);
  assert.equal((await pm.post(url(b)).send({ dependsOnTaskId: a, type: 'SS' })).status, 400);
});

test('RF-64: rechaza ciclos directos e indirectos con 422 y no guarda la arista', async () => {
  const { app, db, pid } = setup();
  const [a, b, c, d] = [1, 2, 3, 4].map(() => task(db, { project_id: pid }));
  const pm = await loginAs(app, 'pm');
  assert.equal((await add(pm, b, a)).status, 201); // b depende de a
  assert.equal((await add(pm, c, b)).status, 201); // c depende de b
  const direct = await add(pm, a, b); // a depende de b → ciclo a→b→a
  assert.equal(direct.status, 422);
  assert.equal(direct.body.error.code, 'BUSINESS_RULE');
  assert.match(direct.body.error.message, /ciclo/i);
  assert.equal((await add(pm, a, c)).status, 422); // ciclo indirecto a→c→b→a
  assert.equal(db.prepare('SELECT count(*) FROM task_dependencies').pluck().get(), 2);
  // un diamante sin ciclo es válido
  assert.equal((await add(pm, d, a)).status, 201);
  assert.equal((await add(pm, d, c)).status, 201);
  assert.equal((await add(pm, d, b)).status, 201);
});

test('eliminar dependencia: 204, 404 si no existe; reabre la posibilidad de la arista inversa', async () => {
  const { app, db, pid } = setup();
  const a = task(db, { project_id: pid });
  const b = task(db, { project_id: pid });
  const pm = await loginAs(app, 'pm');
  await add(pm, b, a);
  assert.equal((await add(pm, a, b)).status, 422);
  assert.equal((await pm.delete(`${url(b)}/${a}`)).status, 204);
  assert.equal((await pm.delete(`${url(b)}/${a}`)).status, 404);
  assert.equal((await pm.delete(`${url(b)}/abc`)).status, 404);
  assert.equal((await add(pm, a, b)).status, 201);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) FROM audit_log WHERE entity = 'task_dependency' AND action = 'delete'",
      )
      .pluck()
      .get(),
    1,
  );
});

test('las dependencias se eliminan en cascada con la tarea', async () => {
  const { app, db, pid } = setup();
  const a = task(db, { project_id: pid });
  const b = task(db, { project_id: pid });
  const pm = await loginAs(app, 'pm');
  await add(pm, b, a);
  assert.equal((await pm.delete(`/api/v1/tasks/${a}`)).status, 204);
  assert.equal(db.prepare('SELECT count(*) FROM task_dependencies').pluck().get(), 0);
});

test('tareas de un sprint cerrado no admiten cambios de dependencias', async () => {
  const { app, db, pid } = setup();
  const closed = sprint(db, { project_id: pid, status: 'closed' });
  const a = task(db, { project_id: pid });
  const b = task(db, { project_id: pid, sprint_id: closed, status: 'done' });
  const pm = await loginAs(app, 'pm');
  assert.equal((await add(pm, b, a)).status, 422);
});
