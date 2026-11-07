import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, task, assignment, timeEntry } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z')); // miércoles
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const dev2 = teamMember(db, { first_name: 'Beto', last_name: 'Luna' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  user(db, {
    email: 'dev2@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev2,
  });
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
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
  for (const p of [p1, p2]) {
    assignment(db, {
      project_id: p,
      team_member_id: dev,
      start_date: '2026-03-01',
      end_date: '2026-06-30',
    });
    assignment(db, {
      project_id: p,
      team_member_id: dev2,
      start_date: '2026-03-01',
      end_date: '2026-06-30',
    });
  }
  return { db, dev, dev2, p1, p2, app: buildTestApp({ db }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
function seed(db, { dev, dev2, p1, p2 }) {
  timeEntry(db, { project_id: p1, team_member_id: dev, work_date: '2026-05-11', minutes: 120 });
  timeEntry(db, {
    project_id: p1,
    team_member_id: dev,
    work_date: '2026-05-11',
    minutes: 60,
    status: 'submitted',
  });
  timeEntry(db, {
    project_id: p1,
    team_member_id: dev,
    work_date: '2026-05-13',
    minutes: 240,
    status: 'approved',
  });
  timeEntry(db, { project_id: p2, team_member_id: dev, work_date: '2026-05-12', minutes: 90 });
  timeEntry(db, { project_id: p1, team_member_id: dev, work_date: '2026-05-04', minutes: 480 }); // semana anterior
  timeEntry(db, { project_id: p1, team_member_id: dev2, work_date: '2026-05-11', minutes: 300 }); // otro miembro
}

test('hoja semanal por API: días lunes–domingo, filas por proyecto, totales y estados', async () => {
  const { app, db, ...ids } = setup();
  seed(db, ids);
  assert.equal((await request(app).get('/api/v1/time-sheet')).status, 401);
  assert.equal((await (await loginAs(app, 'viewer')).get('/api/v1/time-sheet')).status, 403);
  const res = await (await loginAs(app, 'dev')).get('/api/v1/time-sheet'); // semana actual por defecto
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.weekStart, '2026-05-11');
  assert.equal(d.weekEnd, '2026-05-17');
  assert.deepEqual(d.days, [
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
    '2026-05-15',
    '2026-05-16',
    '2026-05-17',
  ]);
  assert.equal(d.member.name, 'Ana Ruiz');
  assert.equal(d.isOwn, true);
  assert.deepEqual(
    d.rows.map((r) => [r.projectCode, r.total]),
    [
      ['PRJ-2026-001', 420],
      ['PRJ-2026-002', 90],
    ],
  );
  assert.deepEqual(d.rows[0].cells, { '2026-05-11': 180, '2026-05-13': 240 });
  assert.equal(d.dayTotals['2026-05-11'], 180);
  assert.equal(d.dayTotals['2026-05-12'], 90);
  assert.equal(d.total, 510);
  assert.deepEqual(d.statusSummary, { draft: 2, submitted: 1, approved: 1, rejected: 0 });
  assert.equal(d.entries.length, 4);
});

test('hoja semanal: cualquier fecha de la semana, semanas anteriores y fechas inválidas', async () => {
  const { app, db, ...ids } = setup();
  seed(db, ids);
  const dev = await loginAs(app, 'dev');
  const prev = await dev.get('/api/v1/time-sheet?week=2026-05-06'); // miércoles de la semana anterior
  assert.equal(prev.body.data.weekStart, '2026-05-04');
  assert.equal(prev.body.data.total, 480);
  assert.equal(
    (await dev.get('/api/v1/time-sheet?week=2026-05-17')).body.data.weekStart,
    '2026-05-11',
  ); // domingo
  assert.equal((await dev.get('/api/v1/time-sheet?week=2026-05-26')).body.data.total, 0); // semana vacía
  assert.equal((await dev.get('/api/v1/time-sheet?week=hoy')).status, 400);
});

test('hoja ajena: developer no; admin y pm la ven con memberId (solo lectura)', async () => {
  const { app, db, dev2, ...ids } = setup();
  seed(db, { ...ids, dev2 });
  const dev = await loginAs(app, 'dev');
  const own = await dev.get(`/api/v1/time-sheet?memberId=${dev2}`); // se ignora: devuelve la propia
  assert.equal(own.body.data.member.name, 'Ana Ruiz');
  const pm = await loginAs(app, 'pm');
  const other = await pm.get(`/api/v1/time-sheet?memberId=${dev2}`);
  assert.equal(other.body.data.member.name, 'Beto Luna');
  assert.equal(other.body.data.isOwn, false);
  assert.equal(other.body.data.total, 300);
  assert.equal((await pm.get('/api/v1/time-sheet?memberId=9999')).status, 404);
  // pm sin miembro vinculado y sin memberId: 403 (no tiene hoja propia)
  assert.equal((await pm.get('/api/v1/time-sheet')).status, 403);
});

test('vista /time: tabla semanal, navegación y formulario de alta solo en la hoja propia', async () => {
  const { app, db, ...ids } = setup();
  seed(db, ids);
  assert.equal((await request(app).get('/time')).status, 302);
  assert.equal((await (await loginAs(app, 'viewer')).get('/time')).status, 403);
  const dev = await loginAs(app, 'dev');
  const page = await dev.get('/time');
  assert.equal(page.status, 200);
  assert.match(page.text, /PRJ-2026-001/);
  assert.match(page.text, /8\.5 h/); // total semanal 510 min
  assert.match(page.text, /week=2026-05-04/); // semana anterior
  assert.match(page.text, /week=2026-05-18/); // semana siguiente
  assert.match(page.text, /name="workDate"/);
  const pm = await loginAs(app, 'pm');
  const other = await pm.get(`/time?memberId=${ids.dev2}`);
  assert.equal(other.status, 200);
  assert.match(other.text, /Beto Luna/);
  assert.doesNotMatch(other.text, /name="workDate"/);
});

test('alta, edición y baja desde la hoja (horas → minutos) y errores vuelven a la hoja', async () => {
  const { app, db, dev, p1 } = setup();
  const t = task(db, { project_id: p1, title: 'Login' });
  const d = await loginAs(app, 'dev');
  const ok = await d
    .post('/time/entries')
    .type('form')
    .send({
      projectId: String(p1),
      taskId: String(t),
      workDate: '2026-05-12',
      hours: '1.5',
      description: 'Pruebas',
    });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/time?week=2026-05-12');
  const row = db.prepare('SELECT * FROM time_entries WHERE team_member_id = ?').get(dev);
  assert.equal(row.minutes, 90);
  assert.equal(row.task_id, t);
  const bad = await d
    .post('/time/entries')
    .type('form')
    .send({
      projectId: String(p1),
      workDate: '2026-05-20',
      hours: '1',
      description: 'Futuro',
    });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /futuras/);
  const badHours = await d
    .post('/time/entries')
    .type('form')
    .send({
      projectId: String(p1),
      workDate: '2026-05-12',
      hours: 'mucho',
      description: 'x',
    });
  assert.equal(badHours.status, 400);

  assert.match((await d.get(`/time/entries/${row.id}`)).text, /Pruebas/);
  const edit = await d
    .post(`/time/entries/${row.id}`)
    .type('form')
    .send({
      projectId: String(p1),
      taskId: '',
      workDate: '2026-05-12',
      hours: '2',
      description: 'Pruebas ampliadas',
    });
  assert.equal(edit.status, 302);
  const after = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(row.id);
  assert.equal(after.minutes, 120);
  assert.equal(after.task_id, null);
  const del = await d.post(`/time/entries/${row.id}/delete`).type('form').send({});
  assert.equal(del.status, 302);
  assert.equal(db.prepare('SELECT count(*) FROM time_entries').pluck().get(), 0);
  const other = await loginAs(app, 'dev2');
  assert.equal((await other.get(`/time/entries/${row.id}`)).status, 404);
  assert.equal(
    (await (await loginAs(app, 'viewer')).post('/time/entries').type('form').send({})).status,
    403,
  );
});

test('vista /time: un admin o pm sin miembro vinculado va a las aprobaciones; un developer sin vínculo sigue con 403', async () => {
  const { app, db } = setup();
  user(db, { email: 'solo@test.local', password_hash: hash, role: 'developer' });
  const admin = await loginAs(app, 'admin');
  const res = await admin.get('/time');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/time/approvals');
  assert.equal((await admin.get('/time/approvals')).status, 200);
  assert.equal((await (await loginAs(app, 'pm')).get('/time')).headers.location, '/time/approvals');
  assert.equal((await admin.get('/api/v1/time-sheet')).status, 403); // la API no cambia
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'solo@test.local', password: PASSWORD });
  assert.equal((await agent.get('/time')).status, 403);
});
