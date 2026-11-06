import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember, internalClient, externalClient, project } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const ext = externalClient(db, { name: 'Globex' });
  internalClient(db, { name: 'Finanzas' });
  const p = project(db, {
    code: 'PRJ-2026-001',
    name: 'Portal',
    client_id: ext,
    manager_id: lead,
    status: 'active',
  });
  return { db, p, lead, ext, app: buildTestApp({ db }) };
}
async function loginAs(app, role = 'viewer') {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

test('tablero: sin sesión redirige; visible para todos los roles', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/dashboard')).status, 302);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const res = await (await loginAs(app, role)).get('/dashboard');
    assert.equal(res.status, 200, role);
    assert.match(res.text, /Tablero de KPIs/);
  }
});

test('filtros: periodo, tipo de cliente, cliente, proyecto y líder con sus opciones', async () => {
  const { app, p, lead, ext } = setup();
  const page = await (
    await loginAs(app)
  ).get('/dashboard?from=2026-05-01&to=2026-05-10&clientType=external');
  assert.match(page.text, /<form[^>]+id="dashboard-filters"/);
  assert.match(page.text, /name="from"[^>]*value="2026-05-01"/);
  assert.match(page.text, /name="to"[^>]*value="2026-05-10"/);
  assert.match(page.text, /<option value="external" selected>/);
  assert.match(page.text, new RegExp(`<option value="${ext}"[^>]*>Globex`));
  assert.match(page.text, /Finanzas/);
  assert.match(page.text, new RegExp(`<option value="${p}"[^>]*>PRJ-2026-001`));
  assert.match(page.text, new RegExp(`<option value="${lead}"[^>]*>Lía Vega`));
});

test('contenedores del tablero, gráficas y scripts locales (sin CDN)', async () => {
  const { app } = setup();
  const page = await (await loginAs(app)).get('/dashboard');
  assert.match(page.text, /data-dashboard/);
  assert.match(page.text, /id="kpi-cards"/);
  assert.match(page.text, /id="risk-list"/);
  assert.match(page.text, /id="projects-table"/);
  for (const id of ['hours-chart', 'velocity-chart', 'progress-chart']) {
    assert.match(page.text, new RegExp(`<canvas[^>]+id="${id}"`));
  }
  assert.match(page.text, /\/vendor\/chart\.umd\.min\.js/);
  assert.match(page.text, /\/js\/pages\/dashboard\.js/);
  assert.doesNotMatch(page.text, /https?:\/\/(cdn|unpkg|cdnjs)/);
});

test('el script lee la API con los filtros, usa semáforo con texto y no usa innerHTML', async () => {
  const { app } = setup();
  const script = await request(app).get('/js/pages/dashboard.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.match(script.text, /\/api\/v1\/dashboard\/kpis/);
  assert.match(script.text, /Verde/);
  assert.match(script.text, /Ámbar/);
  assert.match(script.text, /Rojo/);
  assert.match(script.text, /Intl\.NumberFormat/); // moneda con su código
  assert.doesNotMatch(script.text, /innerHTML/);
});

test('la navegación incluye el tablero y el inicio lo enlaza', async () => {
  const { app } = setup();
  const home = await (await loginAs(app)).get('/');
  assert.match(home.text, /href="\/dashboard"/);
});
