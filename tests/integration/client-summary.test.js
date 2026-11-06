import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import {
  user,
  teamMember,
  internalClient,
  externalClient,
  project,
  timeEntry,
} from '../helpers/factories.js';

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

function seedExternal(db) {
  const cid = externalClient(db, { name: 'Globex', hourly_rate_cents: 90000, currency: 'USD' });
  const tm = teamMember(db);
  const p1 = project(db, { client_id: cid, code: 'PRJ-2026-001', name: 'Portal' });
  const p2 = project(db, { client_id: cid, code: 'PRJ-2026-002', name: 'App' });
  project(db, { client_id: cid, code: 'PRJ-2026-003', name: 'Vacío' });
  timeEntry(db, {
    project_id: p1,
    team_member_id: tm,
    minutes: 120,
    status: 'approved',
    is_billable: 1,
  });
  timeEntry(db, {
    project_id: p1,
    team_member_id: tm,
    minutes: 30,
    status: 'submitted',
    is_billable: 0,
  });
  timeEntry(db, {
    project_id: p2,
    team_member_id: tm,
    minutes: 90,
    status: 'approved',
    is_billable: 1,
  });
  timeEntry(db, {
    project_id: p2,
    team_member_id: tm,
    minutes: 600,
    status: 'draft',
    is_billable: 1,
  });
  timeEntry(db, {
    project_id: p2,
    team_member_id: tm,
    minutes: 600,
    status: 'rejected',
    rejection_reason: 'x',
    is_billable: 1,
  });
  return cid;
}

test('resumen de cliente externo: proyectos, horas y monto estimado (horas facturables × tarifa)', async () => {
  const { app, db } = setup();
  const cid = seedExternal(db);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const res = await (await loginAs(app, role)).get(`/api/v1/clients/${cid}/summary`);
    assert.equal(res.status, 200, role);
    const d = res.body.data;
    assert.deepEqual(
      d.projects.map((p) => [p.code, p.consumedMinutes, p.billableMinutes]),
      [
        ['PRJ-2026-003', 0, 0],
        ['PRJ-2026-002', 90, 90],
        ['PRJ-2026-001', 150, 120],
      ],
    );
    assert.equal(d.totals.projects, 3);
    assert.equal(d.totals.consumedMinutes, 240);
    assert.equal(d.totals.billableMinutes, 210);
    assert.equal(d.totals.estimatedAmountCents, 315000); // 3.5 h × 900.00
    assert.equal(d.totals.currency, 'USD');
  }
});

test('resumen de cliente interno: sin monto estimado', async () => {
  const { app, db } = setup();
  const cid = internalClient(db);
  const p = project(db, { client_id: cid });
  timeEntry(db, { project_id: p, minutes: 60, status: 'approved', is_billable: 0 });
  const res = await (await loginAs(app, 'pm')).get(`/api/v1/clients/${cid}/summary`);
  assert.equal(res.body.data.totals.consumedMinutes, 60);
  assert.equal('estimatedAmountCents' in res.body.data.totals, false);
  assert.equal('currency' in res.body.data.totals, false);
});

test('resumen: 401 sin sesión y 404 inexistente', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/clients/1/summary')).status, 401);
  assert.equal((await (await loginAs(app, 'pm')).get('/api/v1/clients/9999/summary')).status, 404);
});

test('ficha del cliente externo muestra proyectos, horas y monto; la del interno no muestra monto', async () => {
  const { app, db } = setup();
  const cid = seedExternal(db);
  const viewer = await loginAs(app, 'viewer');
  const page = await viewer.get(`/clients/external/${cid}`);
  assert.match(page.text, /PRJ-2026-001/);
  assert.match(page.text, /Monto estimado/);
  assert.match(page.text, /3150\.00 USD/);
  const icid = internalClient(db);
  project(db, { client_id: icid, code: 'PRJ-2026-009', name: 'Interno' });
  const internal = await viewer.get(`/clients/internal/${icid}`);
  assert.match(internal.text, /PRJ-2026-009/);
  assert.doesNotMatch(internal.text, /Monto estimado/);
});
