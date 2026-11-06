import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, project } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, { code: 'PRJ-2026-001', name: 'Portal' });
  return { db, pid, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

test('vista del Gantt: sin sesión redirige; 404 si el proyecto no existe', async () => {
  const { app, pid } = setup();
  assert.equal((await request(app).get(`/projects/${pid}/gantt`)).status, 302);
  assert.equal((await (await loginAs(app, 'viewer')).get('/projects/9999/gantt')).status, 404);
});

test('vista del Gantt: contenedor, controles de vista (día/semana/mes), agrupación y scripts locales', async () => {
  const { app, pid } = setup();
  const page = await (await loginAs(app, 'viewer')).get(`/projects/${pid}/gantt`);
  assert.equal(page.status, 200);
  assert.match(page.text, /PRJ-2026-001/);
  assert.match(page.text, /data-gantt/);
  assert.match(page.text, new RegExp(`data-project-id="${pid}"`));
  for (const mode of ['Day', 'Week', 'Month']) {
    assert.match(page.text, new RegExp(`data-view-mode="${mode}"`));
  }
  assert.match(page.text, /name="groupBy"/);
  assert.match(page.text, /\/vendor\/frappe-gantt\.css/);
  assert.match(page.text, /\/vendor\/frappe-gantt\.umd\.js/);
  assert.match(page.text, /\/js\/pages\/gantt\.js/);
  assert.doesNotMatch(page.text, /https?:\/\/(cdn|unpkg|cdnjs)/); // sin CDNs (CSP)
});

test('la vista indica si el usuario puede reprogramar (admin/pm)', async () => {
  const { app, pid } = setup();
  for (const [role, can] of [
    ['admin', true],
    ['pm', true],
    ['developer', false],
    ['viewer', false],
  ]) {
    const page = await (await loginAs(app, role)).get(`/projects/${pid}/gantt`);
    assert.match(page.text, new RegExp(`data-can-reschedule="${can}"`), role);
  }
});

test('el Gantt se enlaza desde la ficha del proyecto y desde los sprints', async () => {
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  assert.match((await pm.get(`/projects/${pid}`)).text, new RegExp(`/projects/${pid}/gantt`));
  assert.match(
    (await pm.get(`/projects/${pid}/sprints`)).text,
    new RegExp(`/projects/${pid}/gantt`),
  );
});

test('el script de la página y las librerías se sirven localmente y sin innerHTML', async () => {
  const { app } = setup();
  const script = await request(app).get('/js/pages/gantt.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.match(script.text, /\/api\/v1\/projects\//);
  assert.doesNotMatch(script.text, /innerHTML/);
  assert.equal((await request(app).get('/vendor/frappe-gantt.umd.js')).status, 200);
  assert.equal((await request(app).get('/vendor/frappe-gantt.css')).status, 200);
});
