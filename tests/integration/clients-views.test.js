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

test('vistas de clientes: sin sesión redirige a /login', async () => {
  const { app } = setup();
  for (const url of ['/clients', '/clients/internal', '/clients/external/new']) {
    const res = await request(app).get(url);
    assert.equal(res.status, 302, url);
    assert.equal(res.headers.location, '/login');
  }
});

test('/clients redirige al listado de internos', async () => {
  const { app } = setup();
  const res = await (await loginAs(app, 'viewer')).get('/clients');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/clients/internal');
});

test('listado de internos: busca, filtra por estado y solo muestra internos', async () => {
  const { app, db } = setup();
  internalClient(db, { name: 'Recursos Humanos', department: 'RH' });
  internalClient(db, { name: 'Ventas', department: 'Ventas', is_active: 0 });
  externalClient(db, { name: 'Acme Externo' });
  const pm = await loginAs(app, 'pm');
  const all = await pm.get('/clients/internal');
  assert.equal(all.status, 200);
  assert.match(all.text, /Recursos Humanos/);
  assert.match(all.text, /Ventas/);
  assert.doesNotMatch(all.text, /Acme Externo/);
  const q = await pm.get('/clients/internal?q=recursos');
  assert.doesNotMatch(q.text, /Ventas/);
  const inactive = await pm.get('/clients/internal?status=inactive');
  assert.match(inactive.text, /Ventas/);
  assert.doesNotMatch(inactive.text, /Recursos Humanos/);
});

test('listado de externos muestra RFC y tarifa formateada', async () => {
  const { app, db } = setup();
  externalClient(db, { name: 'Globex', tax_id: 'GLO010101AAA', hourly_rate_cents: 85050 });
  const res = await (await loginAs(app, 'viewer')).get('/clients/external');
  assert.match(res.text, /GLO010101AAA/);
  assert.match(res.text, /850\.50/);
});

test('controles de escritura: visibles para admin/pm, ocultos para developer/viewer', async () => {
  const { app, db } = setup();
  const id = internalClient(db);
  for (const [role, visible] of [
    ['admin', true],
    ['pm', true],
    ['developer', false],
    ['viewer', false],
  ]) {
    const agent = await loginAs(app, role);
    const list = await agent.get('/clients/internal');
    assert.equal(list.text.includes('/clients/internal/new'), visible, `lista ${role}`);
    const detail = await agent.get(`/clients/internal/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.text.includes('>Guardar<'), visible, `ficha ${role}`);
  }
  for (const role of ['developer', 'viewer']) {
    const agent = await loginAs(app, role);
    assert.equal((await agent.get('/clients/internal/new')).status, 403);
    assert.equal(
      (await agent.post('/clients/internal').type('form').send({ name: 'X' })).status,
      403,
    );
    assert.equal(
      (await agent.post(`/clients/internal/${id}`).type('form').send({ name: 'X' })).status,
      403,
    );
  }
});

test('crear interno por formulario: redirige al listado; error muestra el formulario con el mensaje', async () => {
  const { app, db } = setup();
  const pm = await loginAs(app, 'pm');
  const ok = await pm.post('/clients/internal').type('form').send({
    name: 'Compras',
    department: 'Compras',
    costCenter: 'CC-7',
    contactName: '',
    contactEmail: '',
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/clients/internal');
  const row = db.prepare("SELECT * FROM clients WHERE name = 'Compras'").get();
  assert.equal(row.type, 'internal');
  assert.equal(row.cost_center, 'CC-7');
  assert.equal(row.contact_name, null);

  const bad = await pm
    .post('/clients/internal')
    .type('form')
    .send({ name: 'Sin depto', department: '' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);
  assert.match(bad.text, /Sin depto/);
});

test('editar interno por formulario y desactivar con el checkbox', async () => {
  const { app, db } = setup();
  const id = internalClient(db, { name: 'Antes', department: 'TI' });
  const pm = await loginAs(app, 'pm');
  assert.match((await pm.get(`/clients/internal/${id}`)).text, /Antes/);
  const edit = await pm
    .post(`/clients/internal/${id}`)
    .type('form')
    .send({ name: 'Después', department: 'TI', isActive: '1' });
  assert.equal(edit.status, 302);
  assert.equal(db.prepare('SELECT name FROM clients WHERE id = ?').pluck().get(id), 'Después');
  await pm.post(`/clients/internal/${id}`).type('form').send({ name: 'Después', department: 'TI' });
  assert.equal(db.prepare('SELECT is_active FROM clients WHERE id = ?').pluck().get(id), 0);
});

test('un cliente externo no se abre desde la ruta de internos (404)', async () => {
  const { app, db } = setup();
  const id = externalClient(db);
  assert.equal((await (await loginAs(app, 'pm')).get(`/clients/internal/${id}`)).status, 404);
});

test('crear externo por formulario: tarifa en pesos se guarda en centavos; moneda y RFC', async () => {
  const { app, db } = setup();
  const pm = await loginAs(app, 'pm');
  const ok = await pm.post('/clients/external').type('form').send({
    name: 'Acme',
    legalName: 'Acme SA de CV',
    taxId: 'ACM010101AAA',
    hourlyRate: '850.50',
    currency: 'USD',
    address: '',
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/clients/external');
  const row = db.prepare("SELECT * FROM clients WHERE name = 'Acme'").get();
  assert.equal(row.hourly_rate_cents, 85050);
  assert.equal(row.currency, 'USD');
  assert.equal(row.address, null);

  for (const hourlyRate of ['', 'abc', '-5', '10.999']) {
    const bad = await pm
      .post('/clients/external')
      .type('form')
      .send({ name: 'Mala', legalName: 'Mala SA', hourlyRate, currency: 'MXN' });
    assert.equal(bad.status, 400, hourlyRate);
    assert.match(bad.text, /<form/);
  }
  const dup = await pm.post('/clients/external').type('form').send({
    name: 'Otro',
    legalName: 'Otro SA',
    taxId: 'ACM010101AAA',
    hourlyRate: '1',
    currency: 'MXN',
  });
  assert.equal(dup.status, 409);
});

test('editar externo por formulario muestra la tarifa en pesos', async () => {
  const { app, db } = setup();
  const id = externalClient(db, { hourly_rate_cents: 123456 });
  const pm = await loginAs(app, 'pm');
  assert.match((await pm.get(`/clients/external/${id}`)).text, /value="1234\.56"/);
  const edit = await pm.post(`/clients/external/${id}`).type('form').send({
    name: 'Acme',
    legalName: 'Acme SA',
    hourlyRate: '1500',
    currency: 'MXN',
    isActive: '1',
  });
  assert.equal(edit.status, 302);
  assert.equal(
    db.prepare('SELECT hourly_rate_cents FROM clients WHERE id = ?').pluck().get(id),
    150000,
  );
});
