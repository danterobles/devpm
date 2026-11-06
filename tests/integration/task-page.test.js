import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember, project, sprint, task, assignment } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  const devMember = teamMember(db, { first_name: 'Dev', last_name: 'Uno' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  user(db, {
    email: 'developer@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: devMember,
  });
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  assignment(db, { project_id: pid, team_member_id: devMember });
  return { db, pid, devMember, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const sub = (agent, parentId, o = {}) =>
  agent
    .post(`/api/v1/projects/${o.pid}/tasks`)
    .send({ title: 'Subtarea', parentTaskId: parentId, ...o.body });

test('RF-65: subtarea de un nivel, mismo proyecto, sigue el sprint del padre', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid, start_date: '2026-02-02', end_date: '2026-02-13' });
  const parent = task(db, { project_id: pid, sprint_id: sid, status: 'todo' });
  const pm = await loginAs(app, 'pm');
  const ok = await sub(pm, parent, { pid });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.parentTaskId, parent);
  assert.equal(ok.body.data.sprintId, sid);
  assert.equal(ok.body.data.status, 'todo');
  const sid2 = sprint(db, { project_id: pid, start_date: '2026-03-02', end_date: '2026-03-13' });
  assert.equal((await sub(pm, parent, { pid, body: { sprintId: sid2 } })).status, 422);
  assert.equal((await sub(pm, ok.body.data.id, { pid })).status, 422); // nieto
  const foreign = task(db, { project_id: project(db) });
  assert.equal((await sub(pm, foreign, { pid })).status, 422);
  assert.equal((await sub(pm, 9999, { pid })).status, 404);
  assert.equal((await pm.get(`/api/v1/tasks/${parent}`)).body.data.subtaskCount, 1);
});

test('las subtareas siguen al padre al cambiar de sprint o volver al backlog', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid, start_date: '2026-02-02', end_date: '2026-02-13' });
  const sid2 = sprint(db, { project_id: pid, start_date: '2026-03-02', end_date: '2026-03-13' });
  const pm = await loginAs(app, 'pm');
  const parent = (await pm.post(`/api/v1/projects/${pid}/tasks`).send({ title: 'Padre' })).body.data
    .id;
  const child = (await sub(pm, parent, { pid })).body.data.id;
  await pm.patch(`/api/v1/tasks/${parent}`).send({ sprintId: sid });
  const row = () => db.prepare('SELECT sprint_id, status FROM tasks WHERE id = ?').get(child);
  assert.deepEqual({ ...row() }, { sprint_id: sid, status: 'todo' });
  await pm.patch(`/api/v1/tasks/${parent}`).send({ sprintId: sid2 });
  assert.equal(row().sprint_id, sid2);
  assert.equal((await pm.patch(`/api/v1/tasks/${child}`).send({ sprintId: sid })).status, 422); // no por su cuenta
  await pm.patch(`/api/v1/tasks/${parent}`).send({ sprintId: null });
  assert.deepEqual({ ...row() }, { sprint_id: null, status: 'backlog' });
});

test('un padre no pasa a done con subtareas abiertas (422); sí cuando todas están done', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const parent = task(db, { project_id: pid });
  const c1 = (await sub(pm, parent, { pid })).body.data.id;
  const c2 = (await sub(pm, parent, { pid })).body.data.id;
  await pm.post(`/api/v1/tasks/${c1}/status`).send({ status: 'done' });
  const blocked = await pm.post(`/api/v1/tasks/${parent}/status`).send({ status: 'done' });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error.details.openSubtasks, 1);
  await pm.post(`/api/v1/tasks/${c2}/status`).send({ status: 'done' });
  assert.equal(
    (await pm.post(`/api/v1/tasks/${parent}/status`).send({ status: 'done' })).status,
    200,
  );
});

test('una tarea done (o con subtarea done) no sale de su sprint', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid, start_date: '2026-02-02', end_date: '2026-02-13' });
  const pm = await loginAs(app, 'pm');
  const parent = task(db, { project_id: pid, sprint_id: sid, status: 'todo' });
  const child = (await sub(pm, parent, { pid })).body.data.id;
  await pm.post(`/api/v1/tasks/${child}/status`).send({ status: 'done' });
  assert.equal((await pm.patch(`/api/v1/tasks/${parent}`).send({ sprintId: null })).status, 422);
});

test('página de la tarea: datos, historial, subtareas y dependencias visibles a todos; controles por rol', async () => {
  const { app, db, pid, devMember } = setup();
  const a = task(db, { project_id: pid, title: 'Diseño' });
  const t = task(db, { project_id: pid, title: 'Implementar', assignee_id: devMember });
  const child = task(db, { project_id: pid, title: 'Hija', parent_task_id: t });
  db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)').run(t, a);
  db.prepare(
    "INSERT INTO task_status_history (task_id, from_status, to_status) VALUES (?, NULL, 'backlog')",
  ).run(t);
  assert.equal((await request(app).get(`/tasks/${t}`)).status, 302);
  for (const [role, canWrite, canMove] of [
    ['admin', true, true],
    ['pm', true, true],
    ['developer', false, true],
    ['viewer', false, false],
  ]) {
    const page = await (await loginAs(app, role)).get(`/tasks/${t}`);
    assert.equal(page.status, 200, role);
    assert.match(page.text, /Implementar/);
    assert.match(page.text, /Diseño/); // predecesora
    assert.match(page.text, /Hija/);
    assert.match(page.text, /backlog/);
    assert.equal(page.text.includes('>Guardar<'), canWrite, `guardar ${role}`);
    assert.equal(page.text.includes('name="dependsOnTaskId"'), canWrite, `deps ${role}`);
    assert.equal(
      page.text.includes('action="/tasks/' + t + '/subtasks"'),
      canWrite,
      `subtareas ${role}`,
    );
    assert.equal(page.text.includes('action="/tasks/' + t + '/status"'), canMove, `estado ${role}`);
  }
  const viewer = await loginAs(app, 'viewer');
  assert.equal((await viewer.get('/tasks/9999')).status, 404);
  const childPage = await viewer.get(`/tasks/${child}`);
  assert.match(childPage.text, /Subtarea de/);
  assert.doesNotMatch(childPage.text, /action="\/tasks\/\d+\/subtasks"/);
});

test('editar tarea por formulario: horas → minutos, vacíos → null, errores vuelven al formulario', async () => {
  const { app, db, pid } = setup();
  const t = task(db, { project_id: pid, title: 'Original', story_points: 3 });
  const pm = await loginAs(app, 'pm');
  const ok = await pm.post(`/tasks/${t}`).type('form').send({
    title: 'Editada',
    description: '',
    type: 'bug',
    priority: 'high',
    storyPoints: '',
    estimatedHours: '1.5',
    startDate: '2026-02-02',
    dueDate: '2026-02-06',
    assigneeId: '',
    milestoneId: '',
    sprintId: '',
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, `/tasks/${t}`);
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(t);
  assert.equal(row.title, 'Editada');
  assert.equal(row.story_points, null);
  assert.equal(row.estimated_minutes, 90);
  assert.equal(row.description, null);
  assert.equal(row.type, 'bug');
  const bad = await pm.post(`/tasks/${t}`).type('form').send({
    title: '',
    type: 'bug',
    priority: 'high',
    startDate: '',
    dueDate: '',
    estimatedHours: '',
    storyPoints: '',
  });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);
  const dates = await pm.post(`/tasks/${t}`).type('form').send({
    title: 'X',
    type: 'bug',
    priority: 'high',
    startDate: '2026-02-10',
    dueDate: '2026-02-01',
    estimatedHours: '',
    storyPoints: '',
  });
  assert.equal(dates.status, 400);
  const dev = await loginAs(app, 'developer');
  assert.equal((await dev.post(`/tasks/${t}`).type('form').send({ title: 'x' })).status, 403);
});

test('cambiar estado, crear subtarea, agregar/quitar dependencia y eliminar desde la página', async () => {
  const { app, db, pid, devMember } = setup();
  const t = task(db, { project_id: pid, title: 'Tarea', assignee_id: devMember });
  const other = task(db, { project_id: pid, title: 'Otra' });
  const pm = await loginAs(app, 'pm');
  const dev = await loginAs(app, 'developer');

  const st = await dev.post(`/tasks/${t}/status`).type('form').send({ status: 'in_progress' });
  assert.equal(st.status, 302);
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').pluck().get(t), 'in_progress');
  assert.equal(
    (await dev.post(`/tasks/${other}/status`).type('form').send({ status: 'done' })).status,
    403,
  );

  const subOk = await pm
    .post(`/tasks/${t}/subtasks`)
    .type('form')
    .send({
      title: 'Mi subtarea',
      storyPoints: '2',
      estimatedHours: '1',
      assigneeId: String(devMember),
    });
  assert.equal(subOk.status, 302);
  const child = db.prepare("SELECT * FROM tasks WHERE title = 'Mi subtarea'").get();
  assert.equal(child.parent_task_id, t);
  assert.equal(child.estimated_minutes, 60);
  const subBad = await pm.post(`/tasks/${t}/subtasks`).type('form').send({ title: '' });
  assert.equal(subBad.status, 400);
  assert.match(subBad.text, /<form/);

  const dep = await pm
    .post(`/tasks/${t}/dependencies`)
    .type('form')
    .send({ dependsOnTaskId: String(other) });
  assert.equal(dep.status, 302);
  assert.equal(db.prepare('SELECT count(*) FROM task_dependencies').pluck().get(), 1);
  const cycle = await pm
    .post(`/tasks/${other}/dependencies`)
    .type('form')
    .send({ dependsOnTaskId: String(t) });
  assert.equal(cycle.status, 422);
  assert.match(cycle.text, /ciclo/);
  const rm = await pm.post(`/tasks/${t}/dependencies/${other}/delete`).type('form').send({});
  assert.equal(rm.status, 302);
  assert.equal(db.prepare('SELECT count(*) FROM task_dependencies').pluck().get(), 0);

  const del = await pm.post(`/tasks/${other}/delete`).type('form').send({});
  assert.equal(del.status, 302);
  assert.equal(del.headers.location, `/projects/${pid}/backlog`);
  assert.equal(db.prepare('SELECT count(*) FROM tasks WHERE id = ?').pluck().get(other), 0);
  assert.equal((await dev.post(`/tasks/${t}/delete`).type('form').send({})).status, 403);
});
