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

function setup(today = '2026-05-13T18:00:00Z') {
  setClock(() => new Date(today));
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, {
    code: 'PRJ-2026-001',
    name: 'Portal',
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  return { db, pid, app: buildTestApp({ db }) };
}
const snap = (db, sid, date, total, completed) =>
  db
    .prepare(
      'INSERT INTO sprint_daily_snapshots (sprint_id, snapshot_date, total_points, completed_points, remaining_points) VALUES (?, ?, ?, ?, ?)',
    )
    .run(sid, date, total, completed, total - completed);
async function loginAs(app, role = 'viewer') {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

test('burnup: 401 sin sesión; lectura para todos; 404', async () => {
  const { app, pid } = setup();
  assert.equal((await request(app).get(`/api/v1/projects/${pid}/burnup`)).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal(
      (await (await loginAs(app, role)).get(`/api/v1/projects/${pid}/burnup`)).status,
      200,
      role,
    );
  }
  assert.equal((await (await loginAs(app)).get('/api/v1/projects/9999/burnup')).status, 404);
  assert.equal((await (await loginAs(app)).get('/api/v1/projects/abc/burnup')).status, 404);
});

test('sin instantáneas: listas vacías', async () => {
  const { app, pid } = setup();
  const d = (await (await loginAs(app)).get(`/api/v1/projects/${pid}/burnup`)).body.data;
  assert.deepEqual(d.days, []);
  assert.deepEqual(d.scope, []);
  assert.deepEqual(d.completed, []);
  assert.deepEqual(d.project, { id: pid, code: 'PRJ-2026-001', name: 'Portal' });
});

test('suma los sprints del proyecto: alcance total y completado por día', async () => {
  const { app, db, pid } = setup('2026-05-13T18:00:00Z');
  const s1 = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
  });
  snap(db, s1, '2026-05-11', 10, 0);
  snap(db, s1, '2026-05-12', 12, 3); // +2 de alcance
  snap(db, s1, '2026-05-13', 12, 5);
  const d = (await (await loginAs(app)).get(`/api/v1/projects/${pid}/burnup`)).body.data;
  assert.deepEqual(d.days, ['2026-05-11', '2026-05-12', '2026-05-13']);
  assert.deepEqual(d.scope, [10, 12, 12]);
  assert.deepEqual(d.completed, [0, 3, 5]);
  assert.deepEqual(d.remaining, [10, 9, 7]);
});

test('un sprint cerrado aporta su alcance completo hasta el cierre y después solo lo completado; el siguiente se suma', async () => {
  const { app, db, pid } = setup('2026-05-20T18:00:00Z');
  const s1 = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-05-04',
    end_date: '2026-05-08',
  });
  snap(db, s1, '2026-05-04', 30, 0);
  snap(db, s1, '2026-05-08', 30, 20); // cierre: 10 puntos no terminados pasan al siguiente sprint
  const s2 = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
  });
  snap(db, s2, '2026-05-11', 14, 0); // incluye los 10 que continúan
  snap(db, s2, '2026-05-15', 14, 6);
  const d = (await (await loginAs(app)).get(`/api/v1/projects/${pid}/burnup`)).body.data;
  const at = (date) => {
    const i = d.days.indexOf(date);
    return { scope: d.scope[i], completed: d.completed[i] };
  };
  assert.deepEqual(at('2026-05-04'), { scope: 30, completed: 0 });
  assert.deepEqual(at('2026-05-08'), { scope: 30, completed: 20 }); // día de cierre, antes de mover
  assert.deepEqual(at('2026-05-09'), { scope: 20, completed: 20 }); // el sprint cerrado solo aporta lo hecho
  assert.deepEqual(at('2026-05-11'), { scope: 34, completed: 20 }); // 20 + 14 del segundo sprint
  assert.deepEqual(at('2026-05-15'), { scope: 34, completed: 26 });
  assert.deepEqual(at('2026-05-20'), { scope: 34, completed: 26 }); // arrastrado hasta hoy (sprint activo)
  assert.equal(d.days.at(-1), '2026-05-20');
});

test('sin sprints activos el eje termina en la última instantánea', async () => {
  const { app, db, pid } = setup('2026-06-30T18:00:00Z');
  const s1 = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-05-04',
    end_date: '2026-05-08',
  });
  snap(db, s1, '2026-05-04', 5, 0);
  snap(db, s1, '2026-05-06', 5, 5);
  const d = (await (await loginAs(app)).get(`/api/v1/projects/${pid}/burnup`)).body.data;
  assert.equal(d.days.at(-1), '2026-05-06');
  assert.deepEqual(d.scope, [5, 5, 5]);
});

test('vista del burnup: gráfica y tabla accesibles, scripts locales y enlaces', async () => {
  const { app, pid } = setup();
  assert.equal((await request(app).get(`/projects/${pid}/burnup`)).status, 302);
  const v = await loginAs(app);
  assert.equal((await v.get('/projects/9999/burnup')).status, 404);
  const page = await v.get(`/projects/${pid}/burnup`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Burnup/);
  assert.match(page.text, /data-burnup/);
  assert.match(page.text, /<canvas[^>]+id="burnup-chart"/);
  assert.match(page.text, /id="burnup-table"/);
  assert.match(page.text, /\/vendor\/chart\.umd\.min\.js/);
  assert.match(page.text, /\/js\/pages\/burnup\.js/);
  const script = await request(app).get('/js/pages/burnup.js');
  assert.equal(script.status, 200);
  assert.match(script.text, /\/api\/v1\/projects\//);
  assert.match(script.text, /\/burnup/);
  assert.doesNotMatch(script.text, /innerHTML/);
  assert.match((await v.get(`/projects/${pid}`)).text, new RegExp(`/projects/${pid}/burnup`));
});
