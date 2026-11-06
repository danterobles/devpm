import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, assignment } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  return { db, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

afterEach(() => setClock(() => new Date()));

// Miércoles 2026-05-13 → la semana actual inicia el lunes 2026-05-11.
const freeze = () => setClock(() => new Date('2026-05-13T15:00:00Z'));

function seed(db) {
  const ana = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const beto = teamMember(db, { first_name: 'Beto', last_name: 'Luna' });
  teamMember(db, { first_name: 'Inactivo', last_name: 'X', is_active: 0 });
  const p1 = project(db, {
    code: 'PRJ-2026-001',
    name: 'Alfa',
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  const p2 = project(db, {
    code: 'PRJ-2026-002',
    name: 'Beta',
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  assignment(db, {
    project_id: p1,
    team_member_id: ana,
    allocation_percent: 60,
    start_date: '2026-05-01',
    end_date: '2026-05-20',
  });
  assignment(db, {
    project_id: p2,
    team_member_id: ana,
    allocation_percent: 60,
    start_date: '2026-05-18',
    end_date: '2026-06-30',
  });
  assignment(db, {
    project_id: p1,
    team_member_id: beto,
    allocation_percent: 50,
    start_date: '2026-06-01',
    end_date: '2026-06-30',
  });
  // Ausencia de Ana: lun 18 a mié 20 de mayo (3 días hábiles) + sábado 23 (no cuenta).
  db.prepare(
    "INSERT INTO time_off (team_member_id, type, start_date, end_date) VALUES (?, 'vacation', '2026-05-18', '2026-05-20')",
  ).run(ana);
  db.prepare(
    "INSERT INTO time_off (team_member_id, type, start_date, end_date) VALUES (?, 'personal', '2026-05-19', '2026-05-23')",
  ).run(ana);
  return { ana, beto, p1, p2 };
}

test('carga: 401 sin sesión; lectura para todos los roles', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/assignments/load')).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal(
      (await (await loginAs(app, role)).get('/api/v1/assignments/load')).status,
      200,
      role,
    );
  }
});

test('carga: 8 semanas lunes-domingo desde la semana actual por defecto', async () => {
  freeze();
  const { app } = setup();
  const res = await (await loginAs(app, 'viewer')).get('/api/v1/assignments/load');
  const { weeks } = res.body.data;
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks[0], { start: '2026-05-11', end: '2026-05-17' });
  assert.deepEqual(weeks[7], { start: '2026-06-29', end: '2026-07-05' });
});

test('carga: % por semana = suma de dedicación de asignaciones que tocan la semana; alerta > 100', async () => {
  freeze();
  const { app, db } = setup();
  const { ana, beto } = seed(db);
  const res = await (await loginAs(app, 'viewer')).get('/api/v1/assignments/load');
  const rows = res.body.data.members;
  assert.deepEqual(
    rows.map((m) => m.name),
    ['Ana Ruiz', 'Beto Luna'],
  ); // activos, por nombre
  const a = rows.find((m) => m.id === ana);
  // Semanas: 11-17 (60), 18-24 (60 + 60 = 120, alerta), 25-31 (60), 1-7 jun (60), ...
  assert.deepEqual(
    a.weeks.slice(0, 4).map((w) => w.percent),
    [60, 120, 60, 60],
  );
  assert.deepEqual(
    a.weeks.slice(0, 4).map((w) => w.over),
    [false, true, false, false],
  );
  const b = rows.find((m) => m.id === beto);
  assert.deepEqual(
    b.weeks.map((w) => w.percent),
    [0, 0, 0, 50, 50, 50, 50, 50],
  );
});

test('carga: días hábiles de ausencia (unión, sin fines de semana) informativos que no cambian el %', async () => {
  freeze();
  const { app, db } = setup();
  const { ana } = seed(db);
  const res = await (await loginAs(app, 'viewer')).get('/api/v1/assignments/load');
  const a = res.body.data.members.find((m) => m.id === ana);
  // 18-20 vacaciones y 19-23 personal: lun a vie = 5 días hábiles únicos (el sábado 23 no cuenta).
  assert.deepEqual(
    a.weeks.slice(0, 3).map((w) => w.absenceDays),
    [0, 5, 0],
  );
  assert.equal(a.weeks[1].percent, 120);
});

test('carga: rango from/to ajustado a semanas completas; límite de 26 semanas y fechas inválidas 400', async () => {
  freeze();
  const { app, db } = setup();
  seed(db);
  const v = await loginAs(app, 'viewer');
  const res = await v.get('/api/v1/assignments/load?from=2026-05-13&to=2026-05-26');
  assert.deepEqual(res.body.data.weeks, [
    { start: '2026-05-11', end: '2026-05-17' },
    { start: '2026-05-18', end: '2026-05-24' },
    { start: '2026-05-25', end: '2026-05-31' },
  ]);
  assert.equal((await v.get('/api/v1/assignments/load?from=2026-01-01&to=2026-12-31')).status, 400);
  assert.equal((await v.get('/api/v1/assignments/load?from=ayer')).status, 400);
  assert.equal((await v.get('/api/v1/assignments/load?from=2026-06-01&to=2026-05-01')).status, 400);
});

test('matriz: miembros × proyectos con la dedicación; solo lo que toca el rango', async () => {
  freeze();
  const { app, db } = setup();
  const { ana, beto, p1, p2 } = seed(db);
  const v = await loginAs(app, 'viewer');
  const res = await v.get('/api/v1/assignments/matrix?from=2026-05-18&to=2026-05-24');
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.deepEqual(
    d.projects.map((p) => p.code),
    ['PRJ-2026-001', 'PRJ-2026-002'],
  );
  assert.deepEqual(
    d.members.map((m) => m.id),
    [ana],
  ); // Beto no tiene asignación en el rango
  const cells = d.members[0].cells;
  assert.equal(cells[p1].percent, 60);
  assert.equal(cells[p2].percent, 60);
  assert.equal(d.members[0].totalPercent, 120);
  const wide = await v.get('/api/v1/assignments/matrix?from=2026-05-01&to=2026-06-30');
  assert.deepEqual(wide.body.data.members.map((m) => m.id).sort(), [ana, beto].sort());
  assert.equal((await v.get('/api/v1/assignments/matrix?from=xx')).status, 400);
  assert.equal((await request(app).get('/api/v1/assignments/matrix')).status, 401);
});

test('vistas de carga y matriz: HTML para todos, con alerta visible y sin sesión redirige', async () => {
  freeze();
  const { app, db } = setup();
  seed(db);
  assert.equal((await request(app).get('/assignments/load')).status, 302);
  assert.equal((await request(app).get('/assignments/matrix')).status, 302);
  for (const role of ['pm', 'viewer']) {
    const a = await loginAs(app, role);
    const load = await a.get('/assignments/load');
    assert.equal(load.status, 200);
    assert.match(load.text, /Ana Ruiz/);
    assert.match(load.text, /120 %/);
    assert.match(load.text, /sobreasignad/i);
    assert.doesNotMatch(load.text, /Inactivo/);
    const matrix = await a.get('/assignments/matrix?from=2026-05-18&to=2026-05-24');
    assert.equal(matrix.status, 200);
    assert.match(matrix.text, /PRJ-2026-002/);
    assert.match(matrix.text, /60 %/);
  }
  assert.equal((await (await loginAs(app, 'pm')).get('/assignments/load?from=malo')).status, 400);
});
