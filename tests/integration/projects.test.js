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
  assignment,
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
const body = (clientId, o = {}) => ({
  name: 'Portal clientes',
  clientId,
  startDate: '2026-03-02',
  endDate: '2026-08-28',
  ...o,
});

test('API proyectos: 401 sin sesión; leen todos; escriben solo admin y pm', async () => {
  const { app, db } = setup();
  const cid = internalClient(db);
  const pid = project(db, { client_id: cid });
  assert.equal((await request(app).get('/api/v1/projects')).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.get('/api/v1/projects')).status, 200, role);
    assert.equal((await a.get(`/api/v1/projects/${pid}`)).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post('/api/v1/projects').send(body(cid))).status, 403, role);
    assert.equal((await a.patch(`/api/v1/projects/${pid}`).send({ name: 'X' })).status, 403, role);
  }
});

test('crear: código PRJ-AAAA-NNN autogenerado, consecutivo por año, estado planning, valores por defecto', async () => {
  const { app, db } = setup();
  const cid = internalClient(db);
  const pm = await loginAs(app, 'pm');
  const a = await pm.post('/api/v1/projects').send(body(cid));
  assert.equal(a.status, 201);
  assert.equal(a.body.data.code, 'PRJ-2026-001');
  assert.equal(a.body.data.status, 'planning');
  assert.equal(a.body.data.priority, 'medium');
  assert.equal(a.body.data.methodology, 'scrum');
  assert.equal(a.body.data.budgetMinutes, 0);
  assert.equal(a.body.data.budgetCents, null);
  assert.equal(a.body.data.clientName.length > 0, true);
  const b = await pm.post('/api/v1/projects').send(body(cid, { name: 'Otro' }));
  assert.equal(b.body.data.code, 'PRJ-2026-002');
  const c = await pm
    .post('/api/v1/projects')
    .send(body(cid, { startDate: '2027-01-04', endDate: '2027-02-01' }));
  assert.equal(c.body.data.code, 'PRJ-2027-001');
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'project'").pluck().get(),
    3,
  );
});

test('el código ignora uno enviado por el cliente (estricto) y continúa tras códigos manuales existentes', async () => {
  const { app, db } = setup();
  const cid = internalClient(db);
  project(db, { client_id: cid, code: 'PRJ-2026-007' });
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.post('/api/v1/projects').send(body(cid, { code: 'HACK' }))).status, 400);
  assert.equal((await pm.post('/api/v1/projects').send(body(cid))).body.data.code, 'PRJ-2026-008');
});

test('is_billable por defecto según tipo de cliente (RF-34) y editable', async () => {
  const { app, db } = setup();
  const pm = await loginAs(app, 'pm');
  const ext = await pm.post('/api/v1/projects').send(body(externalClient(db)));
  const int = await pm.post('/api/v1/projects').send(body(internalClient(db)));
  assert.equal(ext.body.data.isBillable, true);
  assert.equal(int.body.data.isBillable, false);
  const forced = await pm
    .post('/api/v1/projects')
    .send(body(externalClient(db), { isBillable: false }));
  assert.equal(forced.body.data.isBillable, false);
  const upd = await pm.patch(`/api/v1/projects/${int.body.data.id}`).send({ isBillable: true });
  assert.equal(upd.body.data.isBillable, true);
});

test('validación y reglas de cliente/líder al crear', async () => {
  const { app, db } = setup();
  const cid = internalClient(db);
  const pm = await loginAs(app, 'pm');
  for (const b of [
    body(cid, { name: ' ' }),
    body(cid, { startDate: '2026-02-30' }),
    body(cid, { startDate: '2026-09-01', endDate: '2026-08-01' }),
    body(cid, { priority: 'urgent' }),
    body(cid, { methodology: 'xp' }),
    body(cid, { budgetMinutes: -1 }),
    body(cid, { budgetCents: 1.5 }),
    body(cid, { clientId: undefined }),
    body(cid, { status: 'active' }),
  ]) {
    assert.equal((await pm.post('/api/v1/projects').send(b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await pm.post('/api/v1/projects').send(body(9999))).status, 422);
  const inactive = internalClient(db, { is_active: 0 });
  assert.equal((await pm.post('/api/v1/projects').send(body(inactive))).status, 422);
  assert.equal(
    (await pm.post('/api/v1/projects').send(body(cid, { managerId: 9999 }))).status,
    422,
  );
  const off = teamMember(db, { is_active: 0 });
  assert.equal((await pm.post('/api/v1/projects').send(body(cid, { managerId: off }))).status, 422);
  const mgr = teamMember(db, { first_name: 'Lia', last_name: 'Vega' });
  const ok = await pm.post('/api/v1/projects').send(body(cid, { managerId: mgr }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.managerName, 'Lia Vega');
});

test('listado: filtros, búsqueda, paginación y orden', async () => {
  const { app, db } = setup();
  const c1 = internalClient(db, { name: 'Finanzas' });
  const c2 = externalClient(db, { name: 'Globex' });
  const m = teamMember(db);
  project(db, {
    client_id: c1,
    code: 'PRJ-2026-001',
    name: 'Alfa',
    status: 'active',
    priority: 'high',
  });
  project(db, { client_id: c2, code: 'PRJ-2026-002', name: 'Beta', manager_id: m });
  project(db, { client_id: c2, code: 'PRJ-2026-003', name: 'Gamma', status: 'on_hold' });
  const v = await loginAs(app, 'viewer');
  const get = async (qs) => (await v.get(`/api/v1/projects${qs}`)).body;
  assert.equal((await get('')).meta.total, 3);
  assert.deepEqual(
    (await get('')).data.map((p) => p.code),
    ['PRJ-2026-003', 'PRJ-2026-002', 'PRJ-2026-001'],
  );
  assert.equal((await get('?status=active')).meta.total, 1);
  assert.equal((await get('?priority=high')).meta.total, 1);
  assert.equal((await get(`?clientId=${c2}`)).meta.total, 2);
  assert.equal((await get(`?managerId=${m}`)).meta.total, 1);
  assert.deepEqual(
    (await get('?q=globex')).data.map((p) => p.name),
    ['Gamma', 'Beta'],
  );
  assert.deepEqual(
    (await get('?q=PRJ-2026-001')).data.map((p) => p.name),
    ['Alfa'],
  );
  assert.equal((await get('?pageSize=2&page=2')).data.length, 1);
  assert.equal((await v.get('/api/v1/projects?status=raro')).status, 400);
});

test('detalle 404; editar parcial con bitácora; el estado y el código no se editan', async () => {
  const { app, db } = setup();
  const cid = internalClient(db);
  const pid = project(db, { client_id: cid, code: 'PRJ-2026-001' });
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.get('/api/v1/projects/9999')).status, 404);
  assert.equal((await pm.get('/api/v1/projects/abc')).status, 404);
  const res = await pm.patch(`/api/v1/projects/${pid}`).send({
    name: 'Nuevo nombre',
    priority: 'critical',
    budgetMinutes: 120000,
    budgetCents: 5000000,
    description: 'Desc',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'Nuevo nombre');
  assert.equal(res.body.data.priority, 'critical');
  assert.equal(res.body.data.budgetMinutes, 120000);
  assert.equal(res.body.data.code, 'PRJ-2026-001');
  const audit = db
    .prepare("SELECT changes FROM audit_log WHERE entity = 'project' AND entity_id = ?")
    .pluck()
    .get(pid);
  assert.ok(JSON.parse(audit).name);
  for (const b of [{ code: 'X' }, { status: 'active' }, {}]) {
    assert.equal(
      (await pm.patch(`/api/v1/projects/${pid}`).send(b)).status,
      400,
      JSON.stringify(b),
    );
  }
  assert.equal((await pm.patch('/api/v1/projects/9999').send({ name: 'X' })).status, 404);
});

test('editar fechas: fin >= inicio con los valores combinados y asignaciones dentro del rango', async () => {
  const { app, db } = setup();
  const cid = internalClient(db);
  const pid = project(db, { client_id: cid, start_date: '2026-03-02', end_date: '2026-08-28' });
  assignment(db, { project_id: pid, start_date: '2026-04-01', end_date: '2026-07-31' });
  const pm = await loginAs(app, 'pm');
  assert.equal(
    (await pm.patch(`/api/v1/projects/${pid}`).send({ endDate: '2026-01-01' })).status,
    400,
  );
  assert.equal(
    (await pm.patch(`/api/v1/projects/${pid}`).send({ endDate: '2026-07-15' })).status,
    422,
  );
  assert.equal(
    (await pm.patch(`/api/v1/projects/${pid}`).send({ startDate: '2026-04-15' })).status,
    422,
  );
  assert.equal(
    (
      await pm
        .patch(`/api/v1/projects/${pid}`)
        .send({ startDate: '2026-03-20', endDate: '2026-09-30' })
    ).status,
    200,
  );
});

test('cambiar de cliente solo en planning; el nuevo cliente debe estar activo', async () => {
  const { app, db } = setup();
  const c1 = internalClient(db);
  const c2 = externalClient(db);
  const dead = internalClient(db, { is_active: 0 });
  const planning = project(db, { client_id: c1 });
  const active = project(db, { client_id: c1, status: 'active' });
  const pm = await loginAs(app, 'pm');
  assert.equal(
    (await pm.patch(`/api/v1/projects/${planning}`).send({ clientId: dead })).status,
    422,
  );
  assert.equal(
    (await pm.patch(`/api/v1/projects/${planning}`).send({ clientId: c2 })).body.data.clientId,
    c2,
  );
  assert.equal((await pm.patch(`/api/v1/projects/${active}`).send({ clientId: c2 })).status, 422);
  assert.equal(
    (await pm.patch(`/api/v1/projects/${active}`).send({ clientId: c1, name: 'Mismo cliente' }))
      .status,
    200,
  );
});

test('vistas: listado visible a todos con controles según rol; sin sesión redirige', async () => {
  const { app, db } = setup();
  const cid = internalClient(db, { name: 'Finanzas' });
  const pid = project(db, { client_id: cid, code: 'PRJ-2026-001', name: 'Alfa' });
  assert.equal((await request(app).get('/projects')).status, 302);
  for (const [role, canWrite] of [
    ['admin', true],
    ['pm', true],
    ['developer', false],
    ['viewer', false],
  ]) {
    const a = await loginAs(app, role);
    const list = await a.get('/projects');
    assert.equal(list.status, 200);
    assert.match(list.text, /PRJ-2026-001/);
    assert.equal(list.text.includes('/projects/new'), canWrite, `lista ${role}`);
    const detail = await a.get(`/projects/${pid}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.text.includes('>Guardar<'), canWrite, `ficha ${role}`);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.get('/projects/new')).status, 403);
    assert.equal((await a.post('/projects').type('form').send({})).status, 403);
    assert.equal((await a.post(`/projects/${pid}`).type('form').send({})).status, 403);
  }
});

test('crear y editar proyecto por formulario: horas → minutos, monto en pesos → centavos', async () => {
  const { app, db } = setup();
  const cid = externalClient(db);
  const pm = await loginAs(app, 'pm');
  const ok = await pm
    .post('/projects')
    .type('form')
    .send({
      name: 'Portal',
      description: '',
      clientId: String(cid),
      managerId: '',
      priority: 'high',
      methodology: 'kanban',
      startDate: '2026-03-02',
      endDate: '2026-08-28',
      budgetHours: '1500',
      budgetAmount: '250000.50',
      isBillable: '',
    });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/projects');
  const row = db.prepare("SELECT * FROM projects WHERE name = 'Portal'").get();
  assert.equal(row.code, 'PRJ-2026-001');
  assert.equal(row.budget_minutes, 90000);
  assert.equal(row.budget_cents, 25000050);
  assert.equal(row.is_billable, 1);
  assert.equal(row.manager_id, null);

  const bad = await pm
    .post('/projects')
    .type('form')
    .send({
      name: 'Mala',
      clientId: String(cid),
      priority: 'high',
      methodology: 'kanban',
      startDate: '2026-09-01',
      endDate: '2026-08-01',
      budgetHours: '10',
      budgetAmount: '',
    });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);
  assert.match(bad.text, /Mala/);
  const badNum = await pm
    .post('/projects')
    .type('form')
    .send({
      name: 'Mala2',
      clientId: String(cid),
      priority: 'high',
      methodology: 'kanban',
      startDate: '2026-03-01',
      endDate: '2026-08-01',
      budgetHours: 'abc',
      budgetAmount: '',
    });
  assert.equal(badNum.status, 400);

  const edit = await pm
    .post(`/projects/${row.id}`)
    .type('form')
    .send({
      name: 'Portal v2',
      description: 'x',
      clientId: String(cid),
      managerId: '',
      priority: 'low',
      methodology: 'kanban',
      startDate: '2026-03-02',
      endDate: '2026-09-30',
      budgetHours: '1600',
      budgetAmount: '',
      isBillable: '0',
    });
  assert.equal(edit.status, 302);
  const after = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.id);
  assert.equal(after.name, 'Portal v2');
  assert.equal(after.is_billable, 0);
  assert.equal(after.budget_cents, null);
  assert.equal(after.end_date, '2026-09-30');
});
