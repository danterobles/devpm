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
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-02-02',
    end_date: '2026-02-13',
  });
  return { db, pid, sid, devMember, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

function seed(db, pid, sid, devMember) {
  const mine = task(db, {
    project_id: pid,
    sprint_id: sid,
    title: 'Mía',
    status: 'todo',
    assignee_id: devMember,
    story_points: 3,
  });
  const other = task(db, {
    project_id: pid,
    sprint_id: sid,
    title: 'Ajena',
    status: 'in_progress',
  });
  const done = task(db, {
    project_id: pid,
    sprint_id: sid,
    title: 'Lista',
    status: 'done',
    story_points: 5,
  });
  task(db, { project_id: pid, title: 'Fuera del sprint' });
  return { mine, other, done };
}

test('API del tablero: columnas por estado con tareas del sprint y totales', async () => {
  const { app, db, pid, sid, devMember } = setup();
  const { mine } = seed(db, pid, sid, devMember);
  assert.equal((await request(app).get(`/api/v1/sprints/${sid}/board`)).status, 401);
  const res = await (await loginAs(app, 'viewer')).get(`/api/v1/sprints/${sid}/board`);
  assert.equal(res.status, 200);
  const { sprint: s, columns } = res.body.data;
  assert.equal(s.id, sid);
  assert.deepEqual(
    columns.map((c) => c.status),
    ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done'],
  );
  const byStatus = Object.fromEntries(columns.map((c) => [c.status, c.tasks.map((t) => t.title)]));
  assert.deepEqual(byStatus.todo, ['Mía']);
  assert.deepEqual(byStatus.in_progress, ['Ajena']);
  assert.deepEqual(byStatus.done, ['Lista']);
  assert.equal(columns.find((c) => c.status === 'todo').tasks[0].id, mine);
  assert.equal(columns.find((c) => c.status === 'done').points, 5);
  assert.equal(
    (await (await loginAs(app, 'viewer')).get('/api/v1/sprints/9999/board')).status,
    404,
  );
});

test('vista del tablero: tarjetas por columna; sin sesión redirige; 404 si el sprint no es del proyecto', async () => {
  const { app, db, pid, sid, devMember } = setup();
  seed(db, pid, sid, devMember);
  assert.equal((await request(app).get(`/projects/${pid}/sprints/${sid}/board`)).status, 302);
  const viewer = await loginAs(app, 'viewer');
  const page = await viewer.get(`/projects/${pid}/sprints/${sid}/board`);
  assert.equal(page.status, 200);
  for (const t of ['Mía', 'Ajena', 'Lista']) assert.match(page.text, new RegExp(t));
  assert.doesNotMatch(page.text, /Fuera del sprint/);
  assert.match(page.text, /data-status="in_review"/);
  assert.match(page.text, /\/js\/pages\/board\.js/);
  const otherProject = project(db);
  assert.equal((await viewer.get(`/projects/${otherProject}/sprints/${sid}/board`)).status, 404);
  assert.equal((await viewer.get(`/projects/${pid}/sprints/9999/board`)).status, 404);
});

test('quién puede mover: admin/pm todas, developer solo las suyas, viewer ninguna', async () => {
  const { app, db, pid, sid, devMember } = setup();
  const { mine, other } = seed(db, pid, sid, devMember);
  const movable = (html, id) =>
    new RegExp(`data-task-id="${id}"[^>]*data-can-move="true"`).test(html);
  const get = async (role) =>
    (await (await loginAs(app, role)).get(`/projects/${pid}/sprints/${sid}/board`)).text;
  const pm = await get('pm');
  assert.ok(movable(pm, mine) && movable(pm, other));
  const dev = await get('developer');
  assert.ok(movable(dev, mine));
  assert.ok(!movable(dev, other));
  const viewer = await get('viewer');
  assert.ok(!movable(viewer, mine) && !movable(viewer, other));
});

test('alternativa sin JavaScript: mover una tarjeta con el formulario respeta permisos', async () => {
  const { app, db, pid, sid, devMember } = setup();
  const { mine, other } = seed(db, pid, sid, devMember);
  const url = (id) => `/projects/${pid}/sprints/${sid}/board/${id}/status`;
  const dev = await loginAs(app, 'developer');
  const ok = await dev.post(url(mine)).type('form').send({ status: 'in_review' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, `/projects/${pid}/sprints/${sid}/board`);
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').pluck().get(mine), 'in_review');
  assert.equal((await dev.post(url(other)).type('form').send({ status: 'done' })).status, 403);
  assert.equal(
    db.prepare('SELECT status FROM tasks WHERE id = ?').pluck().get(other),
    'in_progress',
  );
  assert.equal(
    (await (await loginAs(app, 'viewer')).post(url(mine)).type('form').send({ status: 'done' }))
      .status,
    403,
  );
  assert.equal(
    (await (await loginAs(app, 'pm')).post(url(other)).type('form').send({ status: 'blocked' }))
      .status,
    302,
  );
  assert.equal(
    (await (await loginAs(app, 'pm')).post(url(other)).type('form').send({ status: 'raro' }))
      .status,
    400,
  );
});

test('el script del tablero se sirve como archivo estático', async () => {
  const { app } = setup();
  const res = await request(app).get('/js/pages/board.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.text, /dragstart/);
  assert.match(res.text, /\/api\/v1\/tasks\//);
  assert.doesNotMatch(res.text, /innerHTML/);
});
