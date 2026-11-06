import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, assignment, timeEntry } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const dev2 = teamMember(db, { first_name: 'Beto', last_name: 'Luna' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const otherLead = teamMember(db, { first_name: 'Raúl', last_name: 'Soto' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin', team_member_id: null });
  user(db, { email: 'lead@test.local', password_hash: hash, role: 'pm', team_member_id: lead });
  user(db, {
    email: 'otherlead@test.local',
    password_hash: hash,
    role: 'pm',
    team_member_id: otherLead,
  });
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
  const pid = project(db, { manager_id: lead, start_date: '2026-01-05', end_date: '2026-12-18' });
  const other = project(db, {
    manager_id: otherLead,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  for (const p of [pid, other]) {
    for (const m of [dev, dev2, lead]) {
      assignment(db, {
        project_id: p,
        team_member_id: m,
        start_date: '2026-03-01',
        end_date: '2026-06-30',
      });
    }
  }
  return { db, pid, other, dev, dev2, lead, app: buildTestApp({ db }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
const entry = (db, o) => timeEntry(db, { work_date: '2026-05-11', minutes: 60, ...o });
const api = (id, action) => `/api/v1/time-entries/${id}/${action}`;

test('enviar un registro: draft/rejected → submitted; ajeno 404; submitted/approved 422', async () => {
  const { app, db, pid, dev } = setup();
  const draft = entry(db, { project_id: pid, team_member_id: dev });
  const rejected = entry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'rejected',
    rejection_reason: 'Falta detalle',
    work_date: '2026-05-12',
  });
  const submitted = entry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-04',
  });
  const d = await loginAs(app, 'dev');
  const ok = await d.post(api(draft, 'submit')).send({});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.status, 'submitted');
  const again = await d.post(api(rejected, 'submit')).send({});
  assert.equal(again.body.data.status, 'submitted');
  assert.equal(again.body.data.rejectionReason, null);
  assert.equal((await d.post(api(submitted, 'submit')).send({})).status, 422);
  assert.equal(
    (await (await loginAs(app, 'dev2')).post(api(draft, 'submit')).send({})).status,
    404,
  );
  assert.equal((await d.post(api(9999, 'submit')).send({})).status, 404);
  assert.equal(
    (await (await loginAs(app, 'viewer')).post(api(draft, 'submit')).send({})).status,
    403,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) FROM audit_log WHERE entity = 'time_entry' AND action = 'status_change'",
      )
      .pluck()
      .get(),
    2,
  );
});

test('enviar la semana: todos los draft y rejected de lunes a domingo del autor', async () => {
  const { app, db, pid, dev, dev2 } = setup();
  const a = entry(db, { project_id: pid, team_member_id: dev, work_date: '2026-05-11' });
  const b = entry(db, {
    project_id: pid,
    team_member_id: dev,
    work_date: '2026-05-15',
    status: 'rejected',
    rejection_reason: 'x',
  });
  const approved = entry(db, {
    project_id: pid,
    team_member_id: dev,
    work_date: '2026-05-12',
    status: 'approved',
  });
  const prevWeek = entry(db, { project_id: pid, team_member_id: dev, work_date: '2026-05-08' });
  const theirs = entry(db, { project_id: pid, team_member_id: dev2, work_date: '2026-05-11' });
  const d = await loginAs(app, 'dev');
  const res = await d.post('/api/v1/time-entries/submit-week').send({ week: '2026-05-13' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.submitted, 2);
  const status = (id) => db.prepare('SELECT status FROM time_entries WHERE id = ?').pluck().get(id);
  assert.deepEqual([a, b, approved, prevWeek, theirs].map(status), [
    'submitted',
    'submitted',
    'approved',
    'draft',
    'draft',
  ]);
  assert.equal(
    (await d.post('/api/v1/time-entries/submit-week').send({ week: '2026-05-13' })).body.data
      .submitted,
    0,
  );
  assert.equal(
    (await d.post('/api/v1/time-entries/submit-week').send({ week: 'hoy' })).status,
    400,
  );
  assert.equal((await d.post('/api/v1/time-entries/submit-week').send({})).status, 400);
});

test('aprobar: el líder del proyecto y admin sí; pm ajeno 403; developer sin liderazgo 403', async () => {
  const { app, db, pid, dev } = setup();
  const e1 = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-04',
    minutes: 60,
  });
  const e2 = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-05',
    minutes: 60,
  });
  const e3 = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-06',
    minutes: 60,
  });
  assert.equal((await request(app).post(api(e1, 'approve')).send({})).status, 401);
  assert.equal(
    (await (await loginAs(app, 'otherlead')).post(api(e1, 'approve')).send({})).status,
    403,
  );
  assert.equal((await (await loginAs(app, 'dev2')).post(api(e1, 'approve')).send({})).status, 403);
  assert.equal(
    (await (await loginAs(app, 'viewer')).post(api(e1, 'approve')).send({})).status,
    403,
  );
  assert.equal(
    db.prepare('SELECT status FROM time_entries WHERE id = ?').pluck().get(e1),
    'submitted',
  );
  const byLead = await (await loginAs(app, 'lead')).post(api(e1, 'approve')).send({});
  assert.equal(byLead.status, 200);
  assert.equal(byLead.body.data.status, 'approved');
  assert.ok(byLead.body.data.approvedBy);
  assert.ok(byLead.body.data.approvedAt);
  const byAdmin = await (await loginAs(app, 'admin')).post(api(e2, 'approve')).send({});
  assert.equal(byAdmin.status, 200);
  assert.equal((await (await loginAs(app, 'lead')).post(api(e1, 'approve')).send({})).status, 422); // ya aprobado
  assert.equal(
    db.prepare('SELECT status FROM time_entries WHERE id = ?').pluck().get(e3),
    'submitted',
  );
  assert.equal(
    (await (await loginAs(app, 'lead')).post(api(9999, 'approve')).send({})).status,
    404,
  );
});

test('nadie aprueba ni rechaza sus propios registros (incluido el líder)', async () => {
  const { app, db, pid, lead } = setup();
  const own = timeEntry(db, {
    project_id: pid,
    team_member_id: lead,
    status: 'submitted',
    work_date: '2026-05-04',
  });
  const l = await loginAs(app, 'lead');
  const res = await l.post(api(own, 'approve')).send({});
  assert.equal(res.status, 422);
  assert.match(res.body.error.message, /propios/);
  assert.equal((await l.post(api(own, 'reject')).send({ reason: 'x' })).status, 422);
  // otro líder/admin sí puede revisarlo (el admin lo aprueba)
  assert.equal(
    (await (await loginAs(app, 'admin')).post(api(own, 'approve')).send({})).status,
    200,
  );
});

test('rechazar exige motivo; el rechazado vuelve al autor con el motivo y puede reenviarse', async () => {
  const { app, db, pid, dev } = setup();
  const e = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-04',
  });
  const lead = await loginAs(app, 'lead');
  assert.equal((await lead.post(api(e, 'reject')).send({})).status, 400);
  assert.equal((await lead.post(api(e, 'reject')).send({ reason: '  ' })).status, 400);
  assert.equal(
    (await (await loginAs(app, 'otherlead')).post(api(e, 'reject')).send({ reason: 'x' })).status,
    403,
  );
  const res = await lead.post(api(e, 'reject')).send({ reason: 'Falta detalle' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'rejected');
  assert.equal(res.body.data.rejectionReason, 'Falta detalle');
  assert.equal((await lead.post(api(e, 'reject')).send({ reason: 'otra vez' })).status, 422); // ya no está enviado
  const d = await loginAs(app, 'dev');
  assert.equal(
    (await d.get(`/api/v1/time-entries/${e}`)).body.data.rejectionReason,
    'Falta detalle',
  );
  assert.equal((await d.post(api(e, 'submit')).send({})).body.data.status, 'submitted');
});

test('pendientes: el líder ve los enviados de sus proyectos; admin todos; los demás ninguno', async () => {
  const { app, db, pid, other, dev, dev2, lead } = setup();
  const mine = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-04',
  });
  const theirs = timeEntry(db, {
    project_id: other,
    team_member_id: dev2,
    status: 'submitted',
    work_date: '2026-05-05',
  });
  timeEntry(db, { project_id: pid, team_member_id: dev, status: 'draft', work_date: '2026-05-06' });
  timeEntry(db, {
    project_id: pid,
    team_member_id: lead,
    status: 'submitted',
    work_date: '2026-05-07',
  }); // propio del líder
  const ids = async (who) =>
    (await (await loginAs(app, who)).get('/api/v1/time-entries/pending')).body.data
      .map((e) => e.id)
      .sort();
  assert.deepEqual(await ids('lead'), [mine].sort());
  assert.deepEqual(await ids('otherlead'), [theirs]);
  assert.equal((await ids('admin')).length, 3);
  assert.deepEqual(await ids('dev'), []);
  assert.equal(
    (await (await loginAs(app, 'viewer')).get('/api/v1/time-entries/pending')).status,
    403,
  );
});

test('vista de aprobaciones: lista pendientes, aprueba y rechaza con motivo por formulario', async () => {
  const { app, db, pid, dev } = setup();
  const a = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-04',
    description: 'Trabajo A',
  });
  const b = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-05',
    description: 'Trabajo B',
  });
  assert.equal((await request(app).get('/time/approvals')).status, 302);
  assert.equal((await (await loginAs(app, 'viewer')).get('/time/approvals')).status, 403);
  const lead = await loginAs(app, 'lead');
  const page = await lead.get('/time/approvals');
  assert.equal(page.status, 200);
  assert.match(page.text, /Trabajo A/);
  assert.match(page.text, /Ana Ruiz/);
  assert.match(page.text, /name="reason"/);
  const ok = await lead.post(`/time/approvals/${a}/approve`).type('form').send({});
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/time/approvals');
  assert.equal(
    db.prepare('SELECT status FROM time_entries WHERE id = ?').pluck().get(a),
    'approved',
  );
  const noReason = await lead.post(`/time/approvals/${b}/reject`).type('form').send({ reason: '' });
  assert.equal(noReason.status, 400);
  assert.match(noReason.text, /<form/);
  const rej = await lead
    .post(`/time/approvals/${b}/reject`)
    .type('form')
    .send({ reason: 'Detalla las horas' });
  assert.equal(rej.status, 302);
  assert.equal(
    db.prepare('SELECT status, rejection_reason FROM time_entries WHERE id = ?').get(b)
      .rejection_reason,
    'Detalla las horas',
  );
  assert.equal(
    (
      await (
        await loginAs(app, 'otherlead')
      )
        .post(`/time/approvals/${a}/approve`)
        .type('form')
        .send({})
    ).status,
    403,
  );
});

test('la hoja permite enviar un registro y la semana por formulario', async () => {
  const { app, db, pid, dev } = setup();
  const a = entry(db, { project_id: pid, team_member_id: dev, work_date: '2026-05-11' });
  const b = entry(db, { project_id: pid, team_member_id: dev, work_date: '2026-05-12' });
  const d = await loginAs(app, 'dev');
  const page = await d.get('/time');
  assert.match(page.text, /Enviar semana/);
  const one = await d.post(`/time/entries/${a}/submit`).type('form').send({});
  assert.equal(one.status, 302);
  assert.equal(one.headers.location, '/time?week=2026-05-11');
  const week = await d.post('/time/submit-week').type('form').send({ week: '2026-05-11' });
  assert.equal(week.status, 302);
  assert.equal(
    db.prepare('SELECT status FROM time_entries WHERE id = ?').pluck().get(a),
    'submitted',
  );
  assert.equal(
    db.prepare('SELECT status FROM time_entries WHERE id = ?').pluck().get(b),
    'submitted',
  );
  assert.match((await d.get('/time')).text, /Enviar semana/);
});
