import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, internalClient, externalClient } from '../helpers/factories.js';

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

const internal = (o = {}) => ({ type: 'internal', name: 'Finanzas', department: 'Finanzas', ...o });
const external = (o = {}) => ({
  type: 'external',
  name: 'Acme',
  legalName: 'Acme SA de CV',
  hourlyRateCents: 85000,
  ...o,
});

test('permisos: sin sesión 401; leen todos los roles; solo admin y pm escriben', async () => {
  const { app, db } = setup();
  const id = internalClient(db);
  assert.equal((await request(app).get('/api/v1/clients')).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const agent = await loginAs(app, role);
    assert.equal((await agent.get('/api/v1/clients')).status, 200, role);
    assert.equal((await agent.get(`/api/v1/clients/${id}`)).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const agent = await loginAs(app, role);
    assert.equal((await agent.post('/api/v1/clients').send(internal())).status, 403, role);
    assert.equal(
      (await agent.patch(`/api/v1/clients/${id}`).send({ name: 'X' })).status,
      403,
      role,
    );
  }
  for (const role of ['admin', 'pm']) {
    const agent = await loginAs(app, role);
    assert.equal((await agent.post('/api/v1/clients').send(internal())).status, 201, role);
  }
});

test('crear cliente interno: 201 con solo campos de interno y bitácora', async () => {
  const { app, db } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm
    .post('/api/v1/clients')
    .send(internal({ costCenter: 'CC-10', contactName: 'Luis', contactEmail: 'Luis@Acme.com' }));
  assert.equal(res.status, 201);
  const c = res.body.data;
  assert.equal(c.type, 'internal');
  assert.equal(c.department, 'Finanzas');
  assert.equal(c.costCenter, 'CC-10');
  assert.equal(c.contactEmail, 'luis@acme.com');
  assert.equal(c.isActive, true);
  assert.equal('hourlyRateCents' in c, false);
  assert.equal('legalName' in c, false);
  const audit = db.prepare("SELECT action FROM audit_log WHERE entity = 'client'").pluck().get();
  assert.equal(audit, 'create');
});

test('crear cliente externo: moneda MXN por defecto y tarifa en centavos', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post('/api/v1/clients').send(external({ taxId: 'ABC010101XYZ' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.currency, 'MXN');
  assert.equal(res.body.data.hourlyRateCents, 85000);
  assert.equal(res.body.data.taxId, 'ABC010101XYZ');
  assert.equal('department' in res.body.data, false);
  const usd = await pm.post('/api/v1/clients').send(external({ name: 'B', currency: 'USD' }));
  assert.equal(usd.body.data.currency, 'USD');
});

test('validación por tipo', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const bad = [
    { type: 'otro', name: 'X' },
    internal({ department: '' }),
    internal({ name: '  ' }),
    internal({ legalName: 'No aplica a internos' }),
    internal({ contactEmail: 'no-es-correo' }),
    external({ legalName: undefined }),
    external({ hourlyRateCents: undefined }),
    external({ hourlyRateCents: -1 }),
    external({ hourlyRateCents: 10.5 }),
    external({ currency: 'mxn' }),
    external({ currency: 'PESOS' }),
    external({ department: 'No aplica a externos' }),
  ];
  for (const body of bad) {
    const res = await pm.post('/api/v1/clients').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('RFC duplicado responde 409', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  await pm.post('/api/v1/clients').send(external({ taxId: 'DUP' }));
  const dup = await pm.post('/api/v1/clients').send(external({ name: 'Otra', taxId: 'DUP' }));
  assert.equal(dup.status, 409);
});

test('listado: filtros por tipo, estado, búsqueda y paginación', async () => {
  const { app, db } = setup();
  internalClient(db, { name: 'Recursos Humanos', department: 'RH' });
  internalClient(db, { name: 'Ventas', department: 'Ventas', is_active: 0 });
  externalClient(db, { name: 'Acme', legal_name: 'Acme SA' });
  externalClient(db, { name: 'Globex', legal_name: 'Globex Corp' });
  const viewer = await loginAs(app, 'viewer');
  assert.equal((await viewer.get('/api/v1/clients')).body.meta.total, 4);
  assert.equal((await viewer.get('/api/v1/clients?type=external')).body.meta.total, 2);
  assert.equal((await viewer.get('/api/v1/clients?status=inactive')).body.meta.total, 1);
  assert.equal(
    (await viewer.get('/api/v1/clients?status=active&type=internal')).body.meta.total,
    1,
  );
  const q = await viewer.get('/api/v1/clients?q=globex');
  assert.deepEqual(
    q.body.data.map((c) => c.name),
    ['Globex'],
  );
  const byDept = await viewer.get('/api/v1/clients?q=RH');
  assert.deepEqual(
    byDept.body.data.map((c) => c.name),
    ['Recursos Humanos'],
  );
  const page = await viewer.get('/api/v1/clients?pageSize=3&page=2');
  assert.equal(page.body.data.length, 1);
  assert.equal(page.body.meta.pageSize, 3);
  assert.equal((await viewer.get('/api/v1/clients?type=raro')).status, 400);
});

test('detalle: 404 si no existe o el id es inválido', async () => {
  const { app } = setup();
  const viewer = await loginAs(app, 'viewer');
  assert.equal((await viewer.get('/api/v1/clients/9999')).status, 404);
  assert.equal((await viewer.get('/api/v1/clients/abc')).status, 404);
});

test('editar: cambios parciales, desactivar y bitácora; el type no se puede cambiar', async () => {
  const { app, db } = setup();
  const id = externalClient(db, { name: 'Acme', hourly_rate_cents: 1000 });
  const pm = await loginAs(app, 'pm');
  const res = await pm
    .patch(`/api/v1/clients/${id}`)
    .send({ name: 'Acme MX', hourlyRateCents: 99000, isActive: false, notes: 'VIP' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'Acme MX');
  assert.equal(res.body.data.hourlyRateCents, 99000);
  assert.equal(res.body.data.isActive, false);
  assert.equal(res.body.data.legalName, 'Acme SA de CV');
  const audit = db
    .prepare("SELECT action, changes FROM audit_log WHERE entity = 'client' AND entity_id = ?")
    .get(id);
  assert.equal(audit.action, 'update');
  assert.ok(JSON.parse(audit.changes).name);

  assert.equal((await pm.patch(`/api/v1/clients/${id}`).send({ type: 'internal' })).status, 400);
  assert.equal((await pm.patch(`/api/v1/clients/${id}`).send({ department: 'TI' })).status, 400);
  assert.equal((await pm.patch(`/api/v1/clients/${id}`).send({})).status, 400);
  assert.equal((await pm.patch(`/api/v1/clients/${id}`).send({ legalName: '' })).status, 400);
  assert.equal((await pm.patch('/api/v1/clients/9999').send({ name: 'X' })).status, 404);
});

test('editar cliente interno: campos propios, y se puede limpiar un opcional con null', async () => {
  const { app, db } = setup();
  const id = internalClient(db, { cost_center: 'CC-1', contact_name: 'Ana' });
  const pm = await loginAs(app, 'pm');
  const res = await pm
    .patch(`/api/v1/clients/${id}`)
    .send({ department: 'Compras', costCenter: null });
  assert.equal(res.body.data.department, 'Compras');
  assert.equal(res.body.data.costCenter, null);
  assert.equal(res.body.data.contactName, 'Ana');
});
