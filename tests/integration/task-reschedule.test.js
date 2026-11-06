import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, project, task } from '../helpers/factories.js';

// RF-73: al reprogramar (arrastrando o por cualquier edición) el servidor valida dependencias y rango.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, { start_date: '2026-03-02', end_date: '2026-08-28' });
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
const dep = (db, taskId, dependsOn) =>
  db
    .prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)')
    .run(taskId, dependsOn);
const move = (agent, id, startDate, dueDate) =>
  agent.patch(`/api/v1/tasks/${id}`).send({ startDate, dueDate });

test('reprogramar: admin y pm pueden; developer y viewer 403; las fechas se guardan', async () => {
  const { app, db, pid } = setup();
  const t = task(db, { project_id: pid, start_date: '2026-04-06', due_date: '2026-04-10' });
  for (const role of ['developer', 'viewer']) {
    assert.equal(
      (await move(await loginAs(app, role), t, '2026-04-13', '2026-04-17')).status,
      403,
      role,
    );
  }
  const res = await move(await loginAs(app, 'pm'), t, '2026-04-13', '2026-04-17');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.startDate, '2026-04-13');
  assert.equal(res.body.data.dueDate, '2026-04-17');
});

test('fin-a-inicio: debe iniciar DESPUÉS de que termine cada predecesora', async () => {
  const { app, db, pid } = setup();
  const pred = task(db, {
    project_id: pid,
    title: 'Diseño',
    start_date: '2026-04-06',
    due_date: '2026-04-10',
  });
  const t = task(db, {
    project_id: pid,
    title: 'Implementación',
    start_date: '2026-04-13',
    due_date: '2026-04-17',
  });
  dep(db, t, pred);
  const pm = await loginAs(app, 'pm');
  const same = await move(pm, t, '2026-04-10', '2026-04-17'); // mismo día que termina la predecesora
  assert.equal(same.status, 422);
  assert.equal(same.body.error.code, 'BUSINESS_RULE');
  assert.match(same.body.error.message, /Diseño/);
  assert.equal((await move(pm, t, '2026-04-01', '2026-04-17')).status, 422); // antes
  assert.equal((await move(pm, t, '2026-04-11', '2026-04-17')).status, 200); // el día siguiente
  assert.equal(
    db.prepare('SELECT start_date FROM tasks WHERE id = ?').pluck().get(t),
    '2026-04-11',
  );
});

test('fin-a-inicio: debe terminar ANTES de que inicie cada sucesora', async () => {
  const { app, db, pid } = setup();
  const t = task(db, {
    project_id: pid,
    title: 'Base',
    start_date: '2026-04-06',
    due_date: '2026-04-10',
  });
  const succ = task(db, {
    project_id: pid,
    title: 'Despliegue',
    start_date: '2026-04-20',
    due_date: '2026-04-24',
  });
  dep(db, succ, t);
  const pm = await loginAs(app, 'pm');
  const same = await move(pm, t, '2026-04-06', '2026-04-20');
  assert.equal(same.status, 422);
  assert.match(same.body.error.message, /Despliegue/);
  assert.equal((await move(pm, t, '2026-04-06', '2026-04-25')).status, 422);
  assert.equal((await move(pm, t, '2026-04-06', '2026-04-19')).status, 200);
  assert.equal(
    db.prepare('SELECT start_date FROM tasks WHERE id = ?').pluck().get(succ),
    '2026-04-20',
  ); // sin cascada
});

test('las tareas relacionadas sin fechas no restringen', async () => {
  const { app, db, pid } = setup();
  const pred = task(db, { project_id: pid });
  const succ = task(db, { project_id: pid });
  const t = task(db, { project_id: pid, start_date: '2026-04-06', due_date: '2026-04-10' });
  dep(db, t, pred);
  dep(db, succ, t);
  assert.equal((await move(await loginAs(app, 'pm'), t, '2026-03-30', '2026-05-01')).status, 200);
});

test('debe quedar dentro del rango del proyecto (inclusivo)', async () => {
  const { app, db, pid } = setup();
  const t = task(db, { project_id: pid, start_date: '2026-04-06', due_date: '2026-04-10' });
  const pm = await loginAs(app, 'pm');
  const before = await move(pm, t, '2026-03-01', '2026-04-10');
  assert.equal(before.status, 422);
  assert.match(before.body.error.message, /proyecto/);
  assert.equal((await move(pm, t, '2026-04-06', '2026-08-29')).status, 422);
  assert.equal((await move(pm, t, '2026-03-02', '2026-08-28')).status, 200); // extremos exactos
});

test('solo se valida lo que se modifica: editar otros campos no falla por fechas previas ya inválidas', async () => {
  const { app, db, pid } = setup();
  const pred = task(db, { project_id: pid, start_date: '2026-04-06', due_date: '2026-04-30' });
  const t = task(db, { project_id: pid, start_date: '2026-04-10', due_date: '2026-04-12' }); // ya viola la dependencia
  dep(db, t, pred);
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.patch(`/api/v1/tasks/${t}`).send({ title: 'Renombrada' })).status, 200);
  assert.equal(
    (await pm.patch(`/api/v1/tasks/${t}`).send({ startDate: '2026-04-10' })).status,
    200,
  ); // sin cambio
  assert.equal((await move(pm, t, '2026-04-11', '2026-04-12')).status, 422); // al tocar fechas sí
});

test('al crear una tarea las fechas deben quedar dentro del proyecto', async () => {
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const url = `/api/v1/projects/${pid}/tasks`;
  assert.equal(
    (await pm.post(url).send({ title: 'Fuera', startDate: '2026-01-05', dueDate: '2026-01-09' }))
      .status,
    422,
  );
  assert.equal(
    (await pm.post(url).send({ title: 'Dentro', startDate: '2026-04-06', dueDate: '2026-04-10' }))
      .status,
    201,
  );
  assert.equal((await pm.post(url).send({ title: 'Sin fechas' })).status, 201);
});

test('la edición por formulario aplica las mismas reglas y muestra el motivo', async () => {
  const { app, db, pid } = setup();
  const pred = task(db, {
    project_id: pid,
    title: 'Diseño',
    start_date: '2026-04-06',
    due_date: '2026-04-10',
  });
  const t = task(db, {
    project_id: pid,
    title: 'Impl',
    start_date: '2026-04-13',
    due_date: '2026-04-17',
  });
  dep(db, t, pred);
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(`/tasks/${t}`).type('form').send({
    title: 'Impl',
    type: 'feature',
    priority: 'medium',
    startDate: '2026-04-08',
    dueDate: '2026-04-17',
    estimatedHours: '',
    storyPoints: '',
  });
  assert.equal(res.status, 422);
  assert.match(res.text, /Diseño/);
});
