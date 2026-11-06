import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, project, sprint } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup({ status = 'active', committed = 10, today = '2026-05-14T18:00:00Z' } = {}) {
  setClock(() => new Date(today));
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  const sid = sprint(db, {
    project_id: pid,
    status,
    start_date: '2026-05-11',
    end_date: '2026-05-15',
    committed_points: committed,
  });
  return { db, pid, sid, app: buildTestApp({ db }) };
}
const snap = (db, sid, date, total, completed, minutes = 0) =>
  db
    .prepare(
      'INSERT INTO sprint_daily_snapshots (sprint_id, snapshot_date, total_points, completed_points, remaining_points, remaining_minutes) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(sid, date, total, completed, total - completed, minutes);
async function viewer(app, role = 'viewer') {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

test('burndown: 401 sin sesión; lectura para todos los roles; 404', async () => {
  const { app, sid } = setup();
  assert.equal((await request(app).get(`/api/v1/sprints/${sid}/burndown`)).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal(
      (await (await viewer(app, role)).get(`/api/v1/sprints/${sid}/burndown`)).status,
      200,
      role,
    );
  }
  const v = await viewer(app);
  assert.equal((await v.get('/api/v1/sprints/9999/burndown')).status, 404);
  assert.equal((await v.get('/api/v1/sprints/abc/burndown')).status, 404);
});

test('forma de la respuesta: días del sprint, ideal, real y cambios de alcance', async () => {
  const { app, db, sid } = setup();
  snap(db, sid, '2026-05-11', 10, 0);
  snap(db, sid, '2026-05-12', 10, 2);
  snap(db, sid, '2026-05-13', 13, 4); // +3 de alcance
  snap(db, sid, '2026-05-14', 13, 6);
  const d = (await (await viewer(app)).get(`/api/v1/sprints/${sid}/burndown`)).body.data;
  assert.deepEqual(d.days, ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']);
  assert.deepEqual(d.ideal, [10, 7.5, 5, 2.5, 0]);
  assert.deepEqual(d.remaining, [10, 8, 9, 7, null]); // el viernes aún no llega (hoy es jueves)
  assert.deepEqual(d.total, [10, 10, 13, 13, null]);
  assert.deepEqual(d.scopeChanges, [0, 0, 3, 0, null]);
  assert.equal(d.today, '2026-05-14');
  assert.equal(d.metric, 'points');
  assert.deepEqual(
    {
      id: d.sprint.id,
      name: d.sprint.name,
      status: d.sprint.status,
      startDate: d.sprint.startDate,
      endDate: d.sprint.endDate,
      committedPoints: d.sprint.committedPoints,
    },
    {
      id: sid,
      name: d.sprint.name,
      status: 'active',
      startDate: '2026-05-11',
      endDate: '2026-05-15',
      committedPoints: 10,
    },
  );
});

test('días pasados sin instantánea arrastran el último valor; antes del inicio real y futuros son null', async () => {
  const { app, db, sid } = setup();
  snap(db, sid, '2026-05-12', 10, 2); // el sprint arrancó el martes
  const d = (await (await viewer(app)).get(`/api/v1/sprints/${sid}/burndown`)).body.data;
  assert.deepEqual(d.remaining, [null, 8, 8, 8, null]); // lunes null; mié y jue arrastrados; vie futuro
  assert.deepEqual(d.scopeChanges, [null, 0, 0, 0, null]);
});

test('sprint cerrado: sin arrastre posterior a la instantánea final', async () => {
  const { app, db, sid } = setup({ status: 'closed', today: '2026-05-20T18:00:00Z' });
  snap(db, sid, '2026-05-11', 10, 0);
  snap(db, sid, '2026-05-13', 10, 10); // cerró el miércoles
  const d = (await (await viewer(app)).get(`/api/v1/sprints/${sid}/burndown`)).body.data;
  assert.deepEqual(d.remaining, [10, 10, 0, null, null]);
});

test('sprint planeado: sin datos reales y el ideal usa los puntos actuales de sus tareas', async () => {
  const { app, db, pid } = setup();
  const planned = sprint(db, {
    project_id: pid,
    status: 'planned',
    start_date: '2026-06-01',
    end_date: '2026-06-03',
  });
  db.prepare(
    "INSERT INTO tasks (project_id, sprint_id, title, story_points) VALUES (?, ?, 'T', 8)",
  ).run(pid, planned);
  const d = (await (await viewer(app)).get(`/api/v1/sprints/${planned}/burndown`)).body.data;
  assert.deepEqual(d.days, ['2026-06-01', '2026-06-02', '2026-06-03']);
  assert.deepEqual(d.ideal, [8, 4, 0]);
  assert.deepEqual(d.remaining, [null, null, null]);
});

test('sprint que se pasó de su fecha final: los días extra aparecen con ideal 0', async () => {
  const { app, db, sid } = setup({ today: '2026-05-19T18:00:00Z' }); // martes siguiente
  snap(db, sid, '2026-05-11', 10, 0);
  snap(db, sid, '2026-05-15', 10, 6);
  const d = (await (await viewer(app)).get(`/api/v1/sprints/${sid}/burndown`)).body.data;
  assert.equal(d.days.at(-1), '2026-05-19');
  assert.equal(d.days.length, 9);
  assert.equal(d.ideal.at(-1), 0);
  assert.equal(d.remaining.at(-1), 4); // arrastrado hasta hoy
});

test('el compromiso del ideal usa committed_points y, si falta, el total de la primera instantánea', async () => {
  const { app, db, sid } = setup({ committed: 10 });
  db.prepare('UPDATE sprints SET committed_points = NULL WHERE id = ?').run(sid);
  snap(db, sid, '2026-05-11', 20, 0);
  const d = (await (await viewer(app)).get(`/api/v1/sprints/${sid}/burndown`)).body.data;
  assert.equal(d.ideal[0], 20);
  assert.equal(d.sprint.committedPoints, null);
});
