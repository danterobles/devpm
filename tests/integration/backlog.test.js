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
const order = (db, pid) =>
  db
    .prepare(
      'SELECT title FROM tasks WHERE project_id = ? AND sprint_id IS NULL ORDER BY sort_order, id',
    )
    .pluck()
    .all(pid);
const seed = (db, pid) =>
  ['A', 'B', 'C'].map((title, i) => task(db, { project_id: pid, title, sort_order: i + 1 }));

test('reordenar backlog por API: nuevo orden, solo admin/pm', async () => {
  const { app, db, pid } = setup();
  const [a, b, c] = seed(db, pid);
  const url = `/api/v1/projects/${pid}/tasks/order`;
  assert.equal(
    (
      await request(app)
        .put(url)
        .send({ taskIds: [c, b, a] })
    ).status,
    401,
  );
  for (const role of ['developer', 'viewer']) {
    assert.equal(
      (await (await loginAs(app, role)).put(url).send({ taskIds: [c, b, a] })).status,
      403,
      role,
    );
  }
  const pm = await loginAs(app, 'pm');
  const res = await pm.put(url).send({ taskIds: [c, a, b] });
  assert.equal(res.status, 200);
  assert.deepEqual(order(db, pid), ['C', 'A', 'B']);
  assert.deepEqual(
    res.body.data.map((t) => t.title),
    ['C', 'A', 'B'],
  );
});

test('reordenar: valida ids (repetidos, de otro proyecto, inexistentes, vacío) y respeta tareas fuera del subconjunto', async () => {
  const { app, db, pid } = setup();
  const [a, b, c] = seed(db, pid);
  const other = task(db, { project_id: project(db) });
  const pm = await loginAs(app, 'pm');
  const url = `/api/v1/projects/${pid}/tasks/order`;
  for (const taskIds of [[], [a, a], [a, other], [a, 9999], 'a']) {
    assert.equal(
      (await pm.put(url).send({ taskIds })).status,
      taskIds === 'a' || taskIds.length === 0 ? 400 : 422,
      JSON.stringify(taskIds),
    );
  }
  assert.equal(
    (await pm.put(`/api/v1/projects/9999/tasks/order`).send({ taskIds: [a] })).status,
    404,
  );
  // subconjunto: solo reordena A y C entre sí (B no cambia)
  await pm.put(url).send({ taskIds: [c, a] });
  assert.deepEqual(order(db, pid), ['C', 'B', 'A']); // B conserva su lugar entre ambas
  assert.equal(db.prepare('SELECT sort_order FROM tasks WHERE id = ?').pluck().get(b), 2);
});

test('el backlog solo lista tareas sin sprint ni padre, en orden', async () => {
  const { app, db, pid } = setup();
  const [a] = seed(db, pid);
  const sid = sprint(db, { project_id: pid });
  task(db, { project_id: pid, title: 'En sprint', sprint_id: sid });
  task(db, { project_id: pid, title: 'Sub', parent_task_id: a });
  const viewer = await loginAs(app, 'viewer');
  const page = await viewer.get(`/projects/${pid}/backlog`);
  assert.equal(page.status, 200);
  for (const t of ['A', 'B', 'C']) assert.match(page.text, new RegExp(`>${t}<`));
  assert.doesNotMatch(page.text, /En sprint/);
  assert.doesNotMatch(page.text, />Sub</);
  assert.equal((await request(app).get(`/projects/${pid}/backlog`)).status, 302);
  assert.equal((await viewer.get('/projects/9999/backlog')).status, 404);
});

test('controles del backlog: visibles solo para admin/pm', async () => {
  const { app, pid, db } = setup();
  seed(db, pid);
  for (const [role, visible] of [
    ['admin', true],
    ['pm', true],
    ['developer', false],
    ['viewer', false],
  ]) {
    const page = await (await loginAs(app, role)).get(`/projects/${pid}/backlog`);
    assert.equal(page.text.includes('name="title"'), visible, role);
    assert.equal(page.text.includes('Subir'), visible, role);
  }
  const v = await loginAs(app, 'viewer');
  assert.equal(
    (await v.post(`/projects/${pid}/backlog`).type('form').send({ title: 'x' })).status,
    403,
  );
});

test('subir y bajar en el backlog por formulario; en los extremos no cambia nada', async () => {
  const { app, db, pid } = setup();
  const [a, b, c] = seed(db, pid);
  const pm = await loginAs(app, 'pm');
  const move = (id, direction) =>
    pm.post(`/projects/${pid}/backlog/${id}/move`).type('form').send({ direction });
  assert.equal((await move(c, 'up')).status, 302);
  assert.deepEqual(order(db, pid), ['A', 'C', 'B']);
  await move(a, 'down');
  assert.deepEqual(order(db, pid), ['C', 'A', 'B']);
  await move(c, 'up'); // ya es el primero
  await move(b, 'down'); // ya es el último
  assert.deepEqual(order(db, pid), ['C', 'A', 'B']);
  assert.equal((await move(a, 'sideways')).status, 400);
  assert.equal((await move(9999, 'up')).status, 404);
});

test('crear tarea desde el backlog por formulario (horas → minutos) y validar', async () => {
  const { app, db, pid } = setup();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  assignment(db, { project_id: pid, team_member_id: dev });
  const pm = await loginAs(app, 'pm');
  const ok = await pm
    .post(`/projects/${pid}/backlog`)
    .type('form')
    .send({
      title: 'Nueva historia',
      type: 'bug',
      priority: 'high',
      storyPoints: '5',
      estimatedHours: '2.5',
      assigneeId: String(dev),
    });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, `/projects/${pid}/backlog`);
  const row = db.prepare("SELECT * FROM tasks WHERE title = 'Nueva historia'").get();
  assert.equal(row.estimated_minutes, 150);
  assert.equal(row.story_points, 5);
  assert.equal(row.assignee_id, dev);
  assert.equal(row.status, 'backlog');
  const bad = await pm
    .post(`/projects/${pid}/backlog`)
    .type('form')
    .send({ title: '', type: 'bug', priority: 'high' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);
  const badHours = await pm
    .post(`/projects/${pid}/backlog`)
    .type('form')
    .send({ title: 'X', type: 'bug', priority: 'high', estimatedHours: 'mucho' });
  assert.equal(badHours.status, 400);
  const badPts = await pm
    .post(`/projects/${pid}/backlog`)
    .type('form')
    .send({ title: 'X', type: 'bug', priority: 'high', storyPoints: '4' });
  assert.equal(badPts.status, 400);
});

test('enviar tarea del backlog a un sprint desde la lista (queda en todo)', async () => {
  const { app, db, pid } = setup();
  const [a] = seed(db, pid);
  const sid = sprint(db, { project_id: pid, start_date: '2026-02-02', end_date: '2026-02-13' });
  const pm = await loginAs(app, 'pm');
  const res = await pm
    .post(`/projects/${pid}/backlog/${a}/sprint`)
    .type('form')
    .send({ sprintId: String(sid) });
  assert.equal(res.status, 302);
  const row = db.prepare('SELECT sprint_id, status FROM tasks WHERE id = ?').get(a);
  assert.deepEqual({ ...row }, { sprint_id: sid, status: 'todo' });
  const closed = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-01-12',
    end_date: '2026-01-23',
  });
  const [, b] = db
    .prepare('SELECT id FROM tasks WHERE sprint_id IS NULL ORDER BY id')
    .pluck()
    .all();
  const bad = await pm
    .post(`/projects/${pid}/backlog/${b}/sprint`)
    .type('form')
    .send({ sprintId: String(closed) });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /<form/);
});
