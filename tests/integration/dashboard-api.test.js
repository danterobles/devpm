import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import {
  user,
  teamMember,
  internalClient,
  externalClient,
  project,
  task,
  timeEntry,
} from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  return { db, app: buildTestApp({ db }) };
}
async function loginAs(app, role = 'viewer') {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const get = async (agent, qs = '') => agent.get(`/api/v1/dashboard/kpis${qs}`);

test('KPIs: 401 sin sesión; lectura para todos los roles', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/dashboard/kpis')).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const res = await get(await loginAs(app, role));
    assert.equal(res.status, 200, role);
    assert.ok(res.body.data.kpis.k1);
  }
});

test('respuesta: periodo por defecto (últimos 30 días), hoy, 16 KPIs, tabla y riesgo', async () => {
  const { app, db } = setup();
  project(db, { status: 'active' });
  const { data } = (await get(await loginAs(app))).body;
  assert.equal(data.today, '2026-05-13');
  assert.deepEqual(data.range, { from: '2026-04-14', to: '2026-05-13' });
  for (const id of [
    'k1',
    'k2',
    'k3',
    'k4',
    'k5',
    'k6',
    'k7',
    'k8',
    'k9',
    'k10',
    'k11',
    'k12',
    'k13',
    'k15',
    'k16',
  ]) {
    assert.ok(id in data.kpis, id);
  }
  assert.ok(Array.isArray(data.projects));
  assert.ok(Array.isArray(data.risk));
  assert.equal(data.kpis.k1.value, 1);
});

test('K14 (ingreso estimado) solo para admin y pm', async () => {
  const { app, db } = setup();
  const p = project(db, {
    client_id: externalClient(db, { hourly_rate_cents: 60000 }),
    status: 'active',
  });
  timeEntry(db, {
    project_id: p,
    work_date: '2026-05-12',
    minutes: 60,
    status: 'approved',
    is_billable: 1,
  });
  for (const role of ['admin', 'pm']) {
    const { data } = (await get(await loginAs(app, role))).body;
    assert.deepEqual(data.kpis.k14.byCurrency, [{ currency: 'MXN', cents: 60000 }], role);
  }
  for (const role of ['developer', 'viewer']) {
    const { data } = (await get(await loginAs(app, role))).body;
    assert.equal('k14' in data.kpis, false, role);
    assert.ok(!JSON.stringify(data).includes('60000'), `sin fugas de tarifa en ${role}`);
  }
});

test('filtros: from/to, clientType, clientId, projectId y managerId', async () => {
  const { app, db } = setup();
  const lead = teamMember(db);
  const ext = externalClient(db);
  const int = internalClient(db);
  const a = project(db, { client_id: ext, manager_id: lead, status: 'active' });
  const b = project(db, { client_id: int, status: 'active' });
  const v = await loginAs(app);
  const k1 = async (qs) => (await get(v, qs)).body.data.kpis.k1.value;
  assert.equal(await k1(''), 2);
  assert.equal(await k1('?clientType=external'), 1);
  assert.equal(await k1(`?clientId=${int}`), 1);
  assert.equal(await k1(`?projectId=${a}`), 1);
  assert.equal(await k1(`?managerId=${lead}`), 1);
  assert.equal(await k1(`?projectId=${b}&clientType=external`), 0); // filtros combinados (AND)
  const ranged = (await get(v, '?from=2026-05-01&to=2026-05-10')).body.data;
  assert.deepEqual(ranged.range, { from: '2026-05-01', to: '2026-05-10' });
  assert.deepEqual(ranged.filters.from, '2026-05-01');
});

test('solo from o solo to completan el otro extremo con el periodo por defecto', async () => {
  const { app } = setup();
  const v = await loginAs(app);
  assert.deepEqual((await get(v, '?from=2026-05-01')).body.data.range, {
    from: '2026-05-01',
    to: '2026-05-13',
  });
  assert.deepEqual((await get(v, '?to=2026-05-10')).body.data.range, {
    from: '2026-04-11',
    to: '2026-05-10',
  });
});

test('filtros inválidos responden 400 (fechas, tipo de cliente, ids, rango invertido, rango excesivo)', async () => {
  const { app } = setup();
  const v = await loginAs(app);
  for (const qs of [
    '?from=ayer',
    '?to=2026-13-01',
    '?clientType=otro',
    '?clientId=abc',
    '?projectId=-1',
    '?managerId=0',
    '?from=2026-05-10&to=2026-05-01',
    '?from=2020-01-01&to=2026-05-13',
  ]) {
    const res = await get(v, qs);
    assert.equal(res.status, 400, qs);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('los semáforos y la lista de riesgo llegan calculados', async () => {
  const { app, db } = setup();
  const p = project(db, {
    status: 'active',
    code: 'P-RISK',
    start_date: '2026-04-01',
    end_date: '2026-05-01',
  });
  task(db, { project_id: p, status: 'blocked', due_date: '2026-05-01' });
  const { data } = (await get(await loginAs(app))).body;
  assert.equal(data.kpis.k10.value, 1);
  assert.equal(data.kpis.k10.status, 'amber');
  assert.equal(data.kpis.k11.status, 'amber');
  assert.deepEqual(
    data.risk.map((r) => [r.code, r.causes.map((c) => c.code)]),
    [['P-RISK', ['OVERDUE']]],
  );
});
