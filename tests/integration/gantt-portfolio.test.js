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
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const portfolio = async (agent) => (await agent.get('/api/v1/gantt/portfolio')).body.data;

test('portafolio: 401 sin sesión; lectura para todos los roles', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/gantt/portfolio')).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal(
      (await (await loginAs(app, role)).get('/api/v1/gantt/portfolio')).status,
      200,
      role,
    );
  }
});

test('solo proyectos activos, una barra por proyecto ordenadas por inicio', async () => {
  const { app, db } = setup();
  const mgr = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const ext = externalClient(db, { name: 'Globex' });
  project(db, {
    code: 'PRJ-2026-002',
    name: 'Beta',
    status: 'active',
    start_date: '2026-04-01',
    end_date: '2026-09-30',
    client_id: ext,
    manager_id: mgr,
    priority: 'high',
  });
  project(db, {
    code: 'PRJ-2026-001',
    name: 'Alfa',
    status: 'active',
    start_date: '2026-02-02',
    end_date: '2026-06-30',
    client_id: internalClient(db, { name: 'Finanzas' }),
  });
  for (const status of ['planning', 'on_hold', 'completed', 'cancelled']) {
    project(db, { code: `X-${status}`, status });
  }
  const d = await portfolio(await loginAs(app, 'viewer'));
  assert.equal(d.today, '2026-05-13');
  assert.deepEqual(
    d.projects.map((p) => p.name),
    ['PRJ-2026-001 · Alfa', 'PRJ-2026-002 · Beta'],
  );
  const beta = d.projects[1];
  assert.equal(beta.id, `p${beta.meta.projectId}`);
  assert.equal(beta.start, '2026-04-01');
  assert.equal(beta.end, '2026-09-30');
  assert.deepEqual(beta.dependencies, []);
  assert.equal(beta.meta.kind, 'project');
  assert.equal(beta.meta.clientName, 'Globex');
  assert.equal(beta.meta.managerName, 'Lía Vega');
  assert.equal(beta.meta.priority, 'high');
  assert.match(beta.custom_class, /^portfolio-high$/);
  assert.doesNotMatch(d.projects[0].custom_class, /\s/);
});

test('avance: puntos done ÷ puntos totales; sin puntos, tareas done ÷ tareas; sin tareas, 0', async () => {
  const { app, db } = setup();
  const mk = (code) =>
    project(db, {
      code,
      name: code,
      status: 'active',
      start_date: '2026-02-02',
      end_date: '2026-06-30',
    });
  const byPoints = mk('P-1');
  task(db, { project_id: byPoints, status: 'done', story_points: 5 });
  task(db, { project_id: byPoints, status: 'in_progress', story_points: 8 });
  task(db, { project_id: byPoints, status: 'todo', story_points: 3 });
  task(db, { project_id: byPoints, status: 'todo' }); // sin puntos: no cuenta en el total
  const byCount = mk('P-2');
  task(db, { project_id: byCount, status: 'done' });
  task(db, { project_id: byCount, status: 'todo' });
  task(db, { project_id: byCount, status: 'todo' });
  task(db, { project_id: byCount, status: 'done' });
  mk('P-3');
  const allDone = mk('P-4');
  task(db, { project_id: allDone, status: 'done', story_points: 3 });
  const d = await portfolio(await loginAs(app, 'pm'));
  const progress = Object.fromEntries(d.projects.map((p) => [p.meta.code, p.progress]));
  assert.deepEqual(progress, { 'P-1': 31, 'P-2': 50, 'P-3': 0, 'P-4': 100 }); // 5/16 = 31 %
});

test('sin proyectos activos devuelve una lista vacía', async () => {
  const { app } = setup();
  const d = await portfolio(await loginAs(app, 'viewer'));
  assert.deepEqual(d.projects, []);
});

test('vista del portafolio: sin sesión redirige; contenedor, escala y scripts locales', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/gantt')).status, 302);
  const page = await (await loginAs(app, 'viewer')).get('/gantt');
  assert.equal(page.status, 200);
  assert.match(page.text, /Portafolio/);
  assert.match(page.text, /data-gantt-portfolio/);
  for (const mode of ['Week', 'Month'])
    assert.match(page.text, new RegExp(`data-view-mode="${mode}"`));
  assert.match(page.text, /\/vendor\/frappe-gantt\.umd\.js/);
  assert.match(page.text, /\/js\/pages\/gantt-portfolio\.js/);
  const script = await request(app).get('/js/pages/gantt-portfolio.js');
  assert.equal(script.status, 200);
  assert.match(script.text, /\/api\/v1\/gantt\/portfolio/);
  assert.match(script.text, /\/projects\//); // clic en una barra abre el Gantt del proyecto
  assert.doesNotMatch(script.text, /innerHTML/);
  assert.match(script.text, /readonly: true/);
  assert.match((await (await loginAs(app, 'viewer')).get('/')).text, /href="\/gantt"/);
});
