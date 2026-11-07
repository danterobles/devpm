import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { loadConfig } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import {
  user,
  teamMember,
  externalClient,
  internalClient,
  project,
  sprint,
  task,
  assignment,
} from '../helpers/factories.js';

// Criterios de aceptación del MVP (PRD §8.2, §8.3, §8.4 y §8.5) con el tablero y el tiempo real.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
const servers = [];
afterEach(async () => {
  setClock(() => new Date());
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function start() {
  setClock(() => new Date('2026-05-13T18:00:00Z')); // miércoles
  const db = createTestDb();
  const dev = teamMember(db, {
    first_name: 'Ana',
    last_name: 'Ruiz',
    weekly_capacity_minutes: 2400,
  });
  const lead = teamMember(db, {
    first_name: 'Lía',
    last_name: 'Vega',
    weekly_capacity_minutes: 2400,
  });
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  user(db, { email: 'lead@test.local', password_hash: hash, role: 'pm', team_member_id: lead });
  const config = loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(40),
    LOG_LEVEL: 'silent',
  });
  const app = createApp({ config, db });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const login = async (who) => {
    const agent = request.agent(app);
    const res = await agent
      .post('/login')
      .type('form')
      .send({ email: `${who}@test.local`, password: PASSWORD });
    agent.cookie = res.headers['set-cookie'][0].split(';')[0];
    return agent;
  };
  return { db, app, port: server.address().port, login, dev, lead };
}

const kpis = async (agent, qs = '') => (await agent.get(`/api/v1/dashboard/kpis${qs}`)).body.data;

test('§8.2 (SSE): al mover una tarea a done llega el evento y los KPIs y el Burndown se actualizan en ≤ 2 s sin recargar', async () => {
  const { db, port, login, dev } = await start();
  const pid = project(db, {
    status: 'active',
    start_date: '2026-05-01',
    end_date: '2026-05-31',
    budget_minutes: 6000,
    manager_id: null,
  });
  assignment(db, {
    project_id: pid,
    team_member_id: dev,
    start_date: '2026-05-01',
    end_date: '2026-05-31',
  });
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
    committed_points: 8,
  });
  const t = task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: 5,
    status: 'in_progress',
    assignee_id: dev,
    due_date: '2026-05-12',
  });
  task(db, { project_id: pid, sprint_id: sid, story_points: 3, status: 'todo' });
  db.prepare(
    "INSERT INTO sprint_daily_snapshots (sprint_id, snapshot_date, total_points, completed_points, remaining_points) VALUES (?, '2026-05-13', 8, 0, 8)",
  ).run(sid);

  const viewer = await login('viewer');
  const developer = await login('dev');
  const before = await kpis(viewer);
  assert.equal(before.kpis.k10.value, 1); // la tarea está vencida
  assert.equal(before.kpis.k2.value, 0);

  // Otra «pestaña» abierta: escucha SSE con la sesión del viewer.
  const events = [];
  const stream = await new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/v1/events', headers: { Cookie: viewer.cookie } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => events.push(chunk));
        resolve({ req, res });
      },
    );
    req.on('error', reject);
  });
  await new Promise((r) => setTimeout(r, 50));
  const started = Date.now();
  assert.equal(
    (await developer.post(`/api/v1/tasks/${t}/status`).send({ status: 'done' })).status,
    200,
  );
  while (!events.join('').includes('event: task.status_changed') && Date.now() - started < 2000) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.match(events.join(''), /event: task\.status_changed/);
  // Al recibir la notificación, la «pestaña» vuelve a leer sus endpoints:
  const after = await kpis(viewer);
  const burndown = (await viewer.get(`/api/v1/sprints/${sid}/burndown`)).body.data;
  assert.ok(Date.now() - started <= 2000, 'evento + relectura en ≤ 2 s');
  assert.equal(after.kpis.k10.value, 0);
  assert.equal(after.kpis.k2.value, 62.5); // 5 de 8 puntos
  assert.equal(burndown.remaining[burndown.days.indexOf('2026-05-13')], 3);
  stream.req.destroy();
});

test('§8.3: el developer registra horas y el pm las aprueba; K4, K6 y K13 cambian (K14 con la aprobación)', async () => {
  const { db, login, dev, lead } = await start();
  const client = externalClient(db, { hourly_rate_cents: 60000 });
  const pid = project(db, {
    client_id: client,
    status: 'active',
    manager_id: lead,
    is_billable: 1,
    start_date: '2026-05-01',
    end_date: '2026-05-31',
    budget_minutes: 6000,
  });
  assignment(db, {
    project_id: pid,
    team_member_id: dev,
    start_date: '2026-05-01',
    end_date: '2026-05-31',
  });
  task(db, { project_id: pid, story_points: 5, status: 'done' });
  task(db, { project_id: pid, story_points: 5, status: 'todo' });

  const developer = await login('dev');
  const pm = await login('lead');
  const range = '?from=2026-05-11&to=2026-05-15';
  const base = await kpis(pm, range);
  assert.deepEqual(
    [
      base.kpis.k4.value,
      base.kpis.k6.loggedMinutes,
      base.kpis.k13.billableMinutes,
      base.kpis.k14.byCurrency,
    ],
    [null, 0, 0, []],
  );

  const entry = await developer
    .post('/api/v1/time-entries')
    .send({ projectId: pid, workDate: '2026-05-12', minutes: 240, description: 'Implementación' });
  assert.equal(entry.status, 201);
  const draft = await kpis(pm, range);
  assert.equal(draft.kpis.k6.loggedMinutes, 0); // un borrador aún no cuenta

  await developer.post(`/api/v1/time-entries/${entry.body.data.id}/submit`).send({});
  const submitted = await kpis(pm, range);
  assert.equal(submitted.kpis.k6.loggedMinutes, 240);
  assert.equal(submitted.kpis.k13.billableMinutes, 240);
  assert.equal(submitted.kpis.k4.value, 12.5); // EV = 0.5·6000 = 3000 min ÷ AC 240 min
  assert.deepEqual(submitted.kpis.k14.byCurrency, []); // sin aprobar no hay ingreso

  assert.equal(
    (await pm.post(`/api/v1/time-entries/${entry.body.data.id}/approve`).send({})).status,
    200,
  );
  const approved = await kpis(pm, range);
  assert.equal(approved.kpis.k6.loggedMinutes, 240);
  assert.equal(approved.kpis.k4.value, 12.5);
  assert.equal(approved.kpis.k13.billableMinutes, 240);
  assert.deepEqual(approved.kpis.k14.byCurrency, [{ currency: 'MXN', cents: 240000 }]); // 4 h × 600.00

  // Si el líder marca las horas como no facturables, K13 cambia y el ingreso desaparece.
  await pm.patch(`/api/v1/time-entries/${entry.body.data.id}/billable`).send({ isBillable: false });
  const nonBillable = await kpis(pm, range);
  assert.equal(nonBillable.kpis.k13.billableMinutes, 0);
  assert.equal(nonBillable.kpis.k13.nonBillableMinutes, 240);
  assert.deepEqual(nonBillable.kpis.k14.byCurrency, []);
});

test('§8.4: 60 % + 60 % en dos proyectos traslapados dan la alerta de sobreasignación y K7 = 1', async () => {
  const { db, login, dev } = await start();
  const cid = internalClient(db);
  const p1 = project(db, {
    client_id: cid,
    status: 'active',
    start_date: '2026-05-01',
    end_date: '2026-06-30',
  });
  const p2 = project(db, {
    client_id: cid,
    status: 'active',
    start_date: '2026-05-01',
    end_date: '2026-06-30',
  });
  const pm = await login('lead');
  const body = (extra) => ({
    teamMemberId: dev,
    projectRole: 'Backend',
    allocationPercent: 60,
    startDate: '2026-05-11',
    endDate: '2026-05-22',
    ...extra,
  });
  const first = await pm.post(`/api/v1/projects/${p1}/assignments`).send(body());
  assert.deepEqual(first.body.warnings, []);
  assert.equal((await kpis(pm, '?from=2026-05-11&to=2026-05-22')).kpis.k7.value, 0);
  const second = await pm.post(`/api/v1/projects/${p2}/assignments`).send(body());
  assert.equal(second.status, 201);
  assert.equal(second.body.warnings[0].code, 'OVER_ALLOCATION');
  assert.equal(second.body.warnings[0].totalPercent, 120);
  const { kpis: k } = await kpis(pm, '?from=2026-05-11&to=2026-05-22');
  assert.equal(k.k7.value, 1);
  assert.deepEqual(k.k7.members, [dev]);
  assert.equal(k.k7.status, 'amber');
});

test('§8.5: un proyecto con fecha fin vencida aparece en «Proyectos en riesgo» con la causa', async () => {
  const { db, login } = await start();
  const late = project(db, {
    code: 'PRJ-LATE',
    name: 'Atrasado',
    status: 'active',
    start_date: '2026-03-02',
    end_date: '2026-05-08',
  });
  project(db, {
    code: 'PRJ-OK',
    name: 'En tiempo',
    status: 'active',
    start_date: '2026-05-01',
    end_date: '2026-08-28',
  });
  const { risk } = await kpis(await login('viewer'));
  assert.deepEqual(
    risk.map((r) => r.code),
    ['PRJ-LATE'],
  );
  assert.equal(risk[0].id, late);
  assert.deepEqual(
    risk[0].causes.map((c) => c.code),
    ['OVERDUE'],
  );
  assert.match(risk[0].causes[0].message, /2026-05-08/);
});
