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
  const dev = teamMember(db);
  const lead = teamMember(db);
  const otherLead = teamMember(db);
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
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
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  const billable = project(db, {
    manager_id: lead,
    is_billable: 1,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  const internal = project(db, {
    manager_id: lead,
    is_billable: 0,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  for (const p of [billable, internal]) {
    assignment(db, {
      project_id: p,
      team_member_id: dev,
      start_date: '2026-03-01',
      end_date: '2026-06-30',
    });
  }
  return { db, billable, internal, dev, app: buildTestApp({ db }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
const body = (projectId) => ({
  projectId,
  workDate: '2026-05-12',
  minutes: 60,
  description: 'Trabajo',
});
const url = (id) => `/api/v1/time-entries/${id}/billable`;

test('RF-54: el registro hereda la bandera del proyecto al crearse (facturable e interno)', async () => {
  const { app, billable, internal } = setup();
  const d = await loginAs(app, 'dev');
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(billable))).body.data.isBillable,
    true,
  );
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(internal))).body.data.isBillable,
    false,
  );
});

test('el líder del proyecto y admin editan la bandera (en cualquier estado); queda en bitácora', async () => {
  const { app, db, billable, dev } = setup();
  const id = timeEntry(db, {
    project_id: billable,
    team_member_id: dev,
    status: 'submitted',
    is_billable: 1,
    work_date: '2026-05-04',
  });
  const lead = await loginAs(app, 'lead');
  const off = await lead.patch(url(id)).send({ isBillable: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.isBillable, false);
  assert.equal(off.body.data.status, 'submitted'); // no cambia el estado
  const admin = await loginAs(app, 'admin');
  assert.equal((await admin.patch(url(id)).send({ isBillable: true })).body.data.isBillable, true);
  const approved = timeEntry(db, {
    project_id: billable,
    team_member_id: dev,
    status: 'approved',
    is_billable: 1,
    work_date: '2026-05-05',
  });
  assert.equal((await lead.patch(url(approved)).send({ isBillable: false })).status, 200);
  const audits = db
    .prepare(
      "SELECT changes FROM audit_log WHERE entity = 'time_entry' AND entity_id = ? AND action = 'update'",
    )
    .pluck()
    .all(id);
  assert.equal(audits.length, 2);
  assert.deepEqual(JSON.parse(audits[0]).is_billable, [1, 0]);
});

test('el autor, un pm ajeno y los demás no pueden cambiarla (403)', async () => {
  const { app, db, billable, dev } = setup();
  const id = timeEntry(db, {
    project_id: billable,
    team_member_id: dev,
    is_billable: 1,
    work_date: '2026-05-04',
  });
  for (const who of ['dev', 'otherlead', 'viewer']) {
    assert.equal(
      (await (await loginAs(app, who)).patch(url(id)).send({ isBillable: false })).status,
      403,
      who,
    );
  }
  assert.equal(db.prepare('SELECT is_billable FROM time_entries WHERE id = ?').pluck().get(id), 1);
  assert.equal((await request(app).patch(url(id)).send({ isBillable: false })).status, 401);
});

test('validación y 404; sin cambio no deja bitácora', async () => {
  const { app, db, billable, dev } = setup();
  const id = timeEntry(db, {
    project_id: billable,
    team_member_id: dev,
    is_billable: 1,
    work_date: '2026-05-04',
  });
  const lead = await loginAs(app, 'lead');
  for (const b of [{}, { isBillable: 'no' }, { isBillable: 0 }, { isBillable: false, extra: 1 }]) {
    assert.equal((await lead.patch(url(id)).send(b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await lead.patch(url(9999)).send({ isBillable: false })).status, 404);
  assert.equal((await lead.patch(url(id)).send({ isBillable: true })).status, 200);
  assert.equal(
    db
      .prepare("SELECT count(*) FROM audit_log WHERE entity = 'time_entry' AND entity_id = ?")
      .pluck()
      .get(id),
    0,
  );
});

test('editar un registro propio no modifica la bandera salvo que cambie de proyecto (hereda del nuevo)', async () => {
  const { app, billable, internal } = setup();
  const d = await loginAs(app, 'dev');
  const id = (await d.post('/api/v1/time-entries').send(body(billable))).body.data.id;
  assert.equal(
    (await d.patch(`/api/v1/time-entries/${id}`).send({ minutes: 90 })).body.data.isBillable,
    true,
  );
  const moved = await d.patch(`/api/v1/time-entries/${id}`).send({ projectId: internal });
  assert.equal(moved.body.data.isBillable, false);
});

test('aprobaciones: el líder cambia la bandera por formulario', async () => {
  const { app, db, billable, dev } = setup();
  const id = timeEntry(db, {
    project_id: billable,
    team_member_id: dev,
    status: 'submitted',
    is_billable: 1,
    work_date: '2026-05-04',
  });
  const lead = await loginAs(app, 'lead');
  assert.match((await lead.get('/time/approvals')).text, /name="isBillable"/);
  const res = await lead
    .post(`/time/approvals/${id}/billable`)
    .type('form')
    .send({ isBillable: '0' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/time/approvals');
  assert.equal(db.prepare('SELECT is_billable FROM time_entries WHERE id = ?').pluck().get(id), 0);
  assert.equal(
    (
      await (
        await loginAs(app, 'otherlead')
      )
        .post(`/time/approvals/${id}/billable`)
        .type('form')
        .send({ isBillable: '1' })
    ).status,
    403,
  );
});
