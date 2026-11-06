import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, sprint, task, assignment } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T16:00:00Z')); // miércoles
  const db = createTestDb();
  const dev = teamMember(db);
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  assignment(db, {
    project_id: pid,
    team_member_id: dev,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  const active = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
    committed_points: 8,
  });
  const planned = sprint(db, {
    project_id: pid,
    status: 'planned',
    start_date: '2026-06-01',
    end_date: '2026-06-12',
  });
  return { db, pid, dev, active, planned, app: buildTestApp({ db }) };
}
async function login(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
const today = (db, sid) =>
  db
    .prepare(
      "SELECT * FROM sprint_daily_snapshots WHERE sprint_id = ? AND snapshot_date = '2026-05-13'",
    )
    .get(sid);
const count = (db, sid) =>
  db.prepare('SELECT count(*) FROM sprint_daily_snapshots WHERE sprint_id = ?').pluck().get(sid);

test('crear una tarea en un sprint activo recalcula la instantánea de hoy', async () => {
  const { app, db, pid, active } = setup();
  const pm = await login(app, 'pm');
  await pm
    .post(`/api/v1/projects/${pid}/tasks`)
    .send({ title: 'A', storyPoints: 5, estimatedMinutes: 120, sprintId: active });
  assert.deepEqual({ ...today(db, active) }.total_points, 5);
  await pm
    .post(`/api/v1/projects/${pid}/tasks`)
    .send({ title: 'B', storyPoints: 3, estimatedMinutes: 60, sprintId: active });
  const row = today(db, active);
  assert.equal(row.total_points, 8);
  assert.equal(row.remaining_minutes, 180);
  assert.equal(count(db, active), 1); // upsert: una sola fila del día
});

test('cambiar el estado a done actualiza completados y restantes (también por un developer)', async () => {
  const { app, db, pid, dev, active } = setup();
  const t = task(db, {
    project_id: pid,
    sprint_id: active,
    story_points: 5,
    status: 'in_progress',
    assignee_id: dev,
    estimated_minutes: 90,
  });
  task(db, { project_id: pid, sprint_id: active, story_points: 3, status: 'todo' });
  const developer = await login(app, 'dev');
  assert.equal(
    (await developer.post(`/api/v1/tasks/${t}/status`).send({ status: 'done' })).status,
    200,
  );
  const row = today(db, active);
  assert.equal(row.completed_points, 5);
  assert.equal(row.remaining_points, 3);
  assert.equal(row.remaining_minutes, 0);
  await developer.post(`/api/v1/tasks/${t}/status`).send({ status: 'in_progress' }); // se reabre
  assert.equal(today(db, active).completed_points, 0);
});

test('editar puntos o estimación y eliminar una tarea recalculan; el cambio de alcance queda reflejado', async () => {
  const { app, db, pid, active } = setup();
  const t = task(db, { project_id: pid, sprint_id: active, story_points: 5, status: 'todo' });
  const pm = await login(app, 'pm');
  await pm.patch(`/api/v1/tasks/${t}`).send({ storyPoints: 13 });
  assert.equal(today(db, active).total_points, 13);
  await pm.patch(`/api/v1/tasks/${t}`).send({ estimatedMinutes: 240 });
  assert.equal(today(db, active).remaining_minutes, 240);
  await pm.delete(`/api/v1/tasks/${t}`);
  assert.equal(today(db, active).total_points, 0);
});

test('mover una tarea entre backlog y sprint recalcula el sprint de origen y el de destino', async () => {
  const { app, db, pid, active } = setup();
  const t = task(db, { project_id: pid, story_points: 5 });
  const pm = await login(app, 'pm');
  await pm.patch(`/api/v1/tasks/${t}`).send({ sprintId: active });
  assert.equal(today(db, active).total_points, 5);
  await pm.patch(`/api/v1/tasks/${t}`).send({ sprintId: null });
  assert.equal(today(db, active).total_points, 0);
});

test('las subtareas y su sprint cuentan: agregar una subtarea cambia el alcance del sprint activo', async () => {
  const { app, db, pid, active } = setup();
  const parent = task(db, { project_id: pid, sprint_id: active, story_points: 5, status: 'todo' });
  const pm = await login(app, 'pm');
  await pm
    .post(`/api/v1/projects/${pid}/tasks`)
    .send({ title: 'Sub', parentTaskId: parent, storyPoints: 2 });
  assert.equal(today(db, active).total_points, 7);
});

test('sprints planeados o cerrados no generan instantáneas al cambiar sus tareas', async () => {
  const { app, db, pid, planned } = setup();
  const closed = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-04-06',
    end_date: '2026-04-17',
  });
  const pm = await login(app, 'pm');
  const t = (
    await pm
      .post(`/api/v1/projects/${pid}/tasks`)
      .send({ title: 'P', storyPoints: 3, sprintId: planned })
  ).body.data.id;
  await pm.post(`/api/v1/tasks/${t}/status`).send({ status: 'in_progress' });
  assert.equal(count(db, planned), 0);
  assert.equal(count(db, closed), 0);
});

test('un cambio rechazado (422) no deja instantánea', async () => {
  const { app, db, pid, active } = setup();
  const t = task(db, { project_id: pid, sprint_id: active, story_points: 5 });
  const pm = await login(app, 'pm');
  assert.equal((await pm.patch(`/api/v1/tasks/${t}`).send({ storyPoints: 4 })).status, 400);
  assert.equal(count(db, active), 0);
});
