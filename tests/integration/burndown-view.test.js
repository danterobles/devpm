import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, project, sprint } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, { code: 'PRJ-2026-001', name: 'Portal' });
  const sid = sprint(db, { project_id: pid, name: 'Sprint 7', status: 'active' });
  return { db, pid, sid, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

test('vista del Burndown: sin sesión redirige; 404 si el sprint no es del proyecto', async () => {
  const { app, pid, sid, db } = setup();
  assert.equal((await request(app).get(`/projects/${pid}/sprints/${sid}/burndown`)).status, 302);
  const v = await loginAs(app, 'viewer');
  assert.equal((await v.get(`/projects/${pid}/sprints/9999/burndown`)).status, 404);
  assert.equal((await v.get(`/projects/${project(db)}/sprints/${sid}/burndown`)).status, 404);
});

test('vista del Burndown: gráfica, tabla alternativa, scripts locales y datos del sprint', async () => {
  const { app, pid, sid } = setup();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const page = await (await loginAs(app, role)).get(`/projects/${pid}/sprints/${sid}/burndown`);
    assert.equal(page.status, 200, role);
    assert.match(page.text, /Burndown/);
    assert.match(page.text, /Sprint 7/);
    assert.match(page.text, /PRJ-2026-001/);
    assert.match(page.text, /data-burndown/);
    assert.match(page.text, new RegExp(`data-sprint-id="${sid}"`));
    assert.match(page.text, /<canvas[^>]+id="burndown-chart"/);
    assert.match(page.text, /role="img"/);
    assert.match(page.text, /id="burndown-table"/); // alternativa accesible en tabla
    assert.match(page.text, /\/vendor\/chart\.umd\.min\.js/);
    assert.match(page.text, /\/js\/pages\/burndown\.js/);
    assert.doesNotMatch(page.text, /https?:\/\/(cdn|unpkg|cdnjs)/);
  }
});

test('el script lee la API del Burndown, dibuja ideal/real/alcance y no usa innerHTML', async () => {
  const { app } = setup();
  const script = await request(app).get('/js/pages/burndown.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.match(script.text, /\/api\/v1\/sprints\//);
  assert.match(script.text, /\/burndown/);
  assert.match(script.text, /ideal/);
  assert.match(script.text, /scopeChanges/);
  assert.doesNotMatch(script.text, /innerHTML/);
  assert.equal((await request(app).get('/vendor/chart.umd.min.js')).status, 200);
});

test('el Burndown se enlaza desde la lista de sprints y desde el tablero', async () => {
  const { app, pid, sid } = setup();
  const pm = await loginAs(app, 'pm');
  const link = new RegExp(`/projects/${pid}/sprints/${sid}/burndown`);
  assert.match((await pm.get(`/projects/${pid}/sprints`)).text, link);
  assert.match((await pm.get(`/projects/${pid}/sprints/${sid}/board`)).text, link);
});

test('RF-83: la vista permite alternar entre puntos y horas y el script pide metric', async () => {
  const { app, pid, sid } = setup();
  const page = await (await loginAs(app, 'viewer')).get(`/projects/${pid}/sprints/${sid}/burndown`);
  assert.match(page.text, /id="burndown-metric"/);
  assert.match(page.text, /value="hours"/);
  const script = (await request(app).get('/js/pages/burndown.js')).text;
  assert.match(script, /metric=/);
  assert.match(script, /Horas restantes/);
  assert.match(script, /\/ 60/); // minutos → horas
});
