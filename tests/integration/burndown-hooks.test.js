import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, project, sprint, task } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-11T16:00:00Z')); // lunes
  const db = createTestDb();
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  const app = buildTestApp({ db });
  return { db, pid, app };
}
async function pmAgent(app) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'pm@test.local', password: PASSWORD });
  return agent;
}
const snaps = (db, sid) =>
  db
    .prepare('SELECT * FROM sprint_daily_snapshots WHERE sprint_id = ? ORDER BY snapshot_date')
    .all(sid);

test('iniciar un sprint guarda la instantánea del día 0 con el alcance comprometido', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid, start_date: '2026-05-11', end_date: '2026-05-22' });
  task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: 5,
    status: 'todo',
    estimated_minutes: 300,
  });
  task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: 8,
    status: 'todo',
    estimated_minutes: 480,
  });
  const pm = await pmAgent(app);
  assert.equal(snaps(db, sid).length, 0);
  assert.equal((await pm.post(`/api/v1/sprints/${sid}/start`).send({})).status, 200);
  const [row, ...rest] = snaps(db, sid);
  assert.equal(rest.length, 0);
  assert.equal(row.snapshot_date, '2026-05-11');
  assert.equal(row.total_points, 13);
  assert.equal(row.completed_points, 0);
  assert.equal(row.remaining_points, 13);
  assert.equal(row.remaining_minutes, 780);
});

test('cerrar un sprint guarda la instantánea final ANTES de mover las tareas no terminadas', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
    committed_points: 13,
  });
  task(db, { project_id: pid, sprint_id: sid, story_points: 5, status: 'done' });
  task(db, { project_id: pid, sprint_id: sid, story_points: 8, status: 'in_progress' });
  setClock(() => new Date('2026-05-22T16:00:00Z'));
  const pm = await pmAgent(app);
  assert.equal((await pm.post(`/api/v1/sprints/${sid}/close`).send({})).status, 200);
  const rows = snaps(db, sid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshot_date, '2026-05-22');
  assert.equal(rows[0].total_points, 13); // el alcance del día de cierre, antes de devolver tareas al backlog
  assert.equal(rows[0].completed_points, 5);
  assert.equal(rows[0].remaining_points, 8);
  assert.equal(db.prepare('SELECT count(*) FROM tasks WHERE sprint_id = ?').pluck().get(sid), 1); // la no terminada salió
});

test('iniciar o cerrar dos veces el mismo día no duplica filas (upsert)', async () => {
  const { app, db, pid } = setup();
  const sid = sprint(db, { project_id: pid, start_date: '2026-05-11', end_date: '2026-05-22' });
  task(db, { project_id: pid, sprint_id: sid, story_points: 3, status: 'todo' });
  const pm = await pmAgent(app);
  await pm.post(`/api/v1/sprints/${sid}/start`).send({});
  await pm.post(`/api/v1/sprints/${sid}/close`).send({}); // mismo día
  assert.equal(snaps(db, sid).length, 1);
});
