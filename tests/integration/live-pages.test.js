import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, project, sprint } from '../helpers/factories.js';

// RF-91: Burndown, Kanban y Gantt se refrescan solos cuando llegan eventos de dominio.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  const pid = project(db, { code: 'PRJ-2026-001' });
  const sid = sprint(db, { project_id: pid, status: 'active' });
  return { pid, sid, app: buildTestApp({ db }) };
}
async function viewer(app) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'viewer@test.local', password: PASSWORD });
  return agent;
}
const script = async (app, path) => (await request(app).get(path)).text;

test('Burndown: contenedor en vivo del proyecto (tareas y sprints), indicador y live.js', async () => {
  const { app, pid, sid } = setup();
  const page = (await (await viewer(app)).get(`/projects/${pid}/sprints/${sid}/burndown`)).text;
  assert.match(page, new RegExp(`data-burndown[^>]*data-live[^>]*data-live-project="${pid}"`));
  assert.match(page, /data-live-types="task\.,sprint\."/);
  assert.match(page, /data-live-status/);
  assert.match(page, /\/js\/lib\/live\.js/);
  const js = await script(app, '/js/pages/burndown.js');
  assert.match(js, /devpm:refresh/);
  assert.match(js, /devpm:loaded/);
});

test('Burnup: se refresca con tareas y sprints del proyecto', async () => {
  const { app, pid } = setup();
  const page = (await (await viewer(app)).get(`/projects/${pid}/burnup`)).text;
  assert.match(page, new RegExp(`data-burnup[^>]*data-live[^>]*data-live-project="${pid}"`));
  assert.match(page, /data-live-types="task\.,sprint\."/);
  assert.match(page, /data-live-status/);
  assert.match(page, /\/js\/lib\/live\.js/);
  const js = await script(app, '/js/pages/burnup.js');
  assert.match(js, /devpm:refresh/);
  assert.match(js, /devpm:loaded/);
});

test('Kanban: contenedor en vivo, indicador y recarga del tablero sin innerHTML', async () => {
  const { app, pid, sid } = setup();
  const page = (await (await viewer(app)).get(`/projects/${pid}/sprints/${sid}/board`)).text;
  assert.match(page, new RegExp(`data-live[^>]*data-live-project="${pid}"`));
  assert.match(page, /data-live-types="task\.,sprint\."/);
  assert.match(page, /data-live-status/);
  assert.match(page, /\/js\/lib\/live\.js/);
  const js = await script(app, '/js/pages/board.js');
  assert.match(js, /devpm:refresh/);
  assert.match(js, /DOMParser/); // vuelve a pedir la página y reemplaza las columnas
  assert.match(js, /devpm:loaded/);
  assert.doesNotMatch(js, /innerHTML/);
});

test('Gantt del proyecto: tareas, hitos y proyecto; ignora el eco de sus propios cambios', async () => {
  const { app, pid } = setup();
  const page = (await (await viewer(app)).get(`/projects/${pid}/gantt`)).text;
  assert.match(page, new RegExp(`data-gantt[^>]*data-live[^>]*data-live-project="${pid}"`));
  assert.match(page, /data-live-types="task\.,milestone\.,project\.,assignment\."/);
  assert.match(page, /data-live-status/);
  assert.match(page, /\/js\/lib\/live\.js/);
  const js = await script(app, '/js/pages/gantt.js');
  assert.match(js, /devpm:refresh/);
  assert.match(js, /devpm:loaded/);
  assert.match(js, /ignoreRefreshUntil/);
});

test('Gantt de portafolio: proyectos, tareas e hitos de todos los proyectos', async () => {
  const { app } = setup();
  const page = (await (await viewer(app)).get('/gantt')).text;
  assert.match(page, /data-gantt-portfolio[^>]*data-live/);
  assert.match(page, /data-live-types="project\.,task\.,milestone\."/);
  assert.match(page, /data-live-status/);
  assert.match(page, /\/js\/lib\/live\.js/);
  const js = await script(app, '/js/pages/gantt-portfolio.js');
  assert.match(js, /devpm:refresh/);
  assert.match(js, /devpm:loaded/);
});
