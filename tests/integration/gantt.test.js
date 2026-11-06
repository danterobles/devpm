import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, sprint, task, timeEntry } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, {
    code: 'PRJ-2026-001',
    name: 'Portal',
    start_date: '2026-03-02',
    end_date: '2026-08-28',
  });
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
const gantt = async (agent, pid, qs = '') =>
  (await agent.get(`/api/v1/projects/${pid}/gantt${qs}`)).body.data;

test('Gantt: 401 sin sesión; lectura para todos los roles; 404 si el proyecto no existe', async () => {
  const { app, pid } = setup();
  assert.equal((await request(app).get(`/api/v1/projects/${pid}/gantt`)).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal(
      (await (await loginAs(app, role)).get(`/api/v1/projects/${pid}/gantt`)).status,
      200,
      role,
    );
  }
  assert.equal(
    (await (await loginAs(app, 'viewer')).get('/api/v1/projects/9999/gantt')).status,
    404,
  );
  assert.equal(
    (await (await loginAs(app, 'viewer')).get('/api/v1/projects/abc/gantt')).status,
    404,
  );
});

test('formato de Frappe Gantt: id, name, start, end, progress, dependencies y custom_class', async () => {
  const { app, db, pid } = setup();
  const a = task(db, {
    project_id: pid,
    title: 'Diseño',
    start_date: '2026-03-02',
    due_date: '2026-03-13',
    status: 'done',
  });
  const b = task(db, {
    project_id: pid,
    title: 'Implementación',
    start_date: '2026-05-18', // futura: «hoy» es 2026-05-13, así no se marca atrasada
    due_date: '2026-06-12',
    status: 'in_progress',
  });
  db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)').run(b, a);
  const d = await gantt(await loginAs(app, 'viewer'), pid);
  assert.equal(d.today, '2026-05-13');
  assert.deepEqual(d.project, {
    id: pid,
    code: 'PRJ-2026-001',
    name: 'Portal',
    startDate: '2026-03-02',
    endDate: '2026-08-28',
  });
  const [first, second] = d.tasks;
  assert.equal(first.id, `t${a}`);
  assert.equal(first.name, 'Diseño');
  assert.equal(first.start, '2026-03-02');
  assert.equal(first.end, '2026-03-13');
  assert.equal(first.progress, 100);
  assert.deepEqual(first.dependencies, []);
  assert.match(first.custom_class, /gantt-done/);
  assert.equal(second.id, `t${b}`);
  assert.deepEqual(second.dependencies, [`t${a}`]);
  assert.match(second.custom_class, /gantt-in_progress/);
  assert.equal(second.meta.kind, 'task');
  assert.equal(second.meta.taskId, b);
  assert.equal(second.meta.canReschedule, undefined);
});

test('progreso: 100 si done; si no horas (enviadas+aprobadas) ÷ estimadas con tope 95; sin estimación 0', async () => {
  const { app, db, pid } = setup();
  const dev = teamMember(db);
  const dates = { start_date: '2026-03-02', due_date: '2026-03-13' };
  const mk = (o) => task(db, { project_id: pid, ...dates, ...o });
  const half = mk({ title: 'Mitad', estimated_minutes: 480 });
  const over = mk({ title: 'Excedida', estimated_minutes: 60 });
  const none = mk({ title: 'Sin estimar' });
  mk({ title: 'Hecha', estimated_minutes: 60, status: 'done' });
  const entry = (taskId, minutes, status) =>
    timeEntry(db, {
      project_id: pid,
      team_member_id: dev,
      task_id: taskId,
      minutes,
      status,
      work_date: '2026-03-03',
    });
  entry(half, 240, 'approved');
  entry(half, 120, 'draft'); // no cuenta
  entry(over, 600, 'submitted');
  entry(none, 120, 'approved');
  const byName = Object.fromEntries(
    (await gantt(await loginAs(app, 'pm'), pid)).tasks.map((t) => [t.name, t.progress]),
  );
  assert.deepEqual(byName, { Mitad: 50, Excedida: 95, 'Sin estimar': 0, Hecha: 100 });
});

test('tareas sin ambas fechas no se dibujan: aparecen en «sin programar»', async () => {
  const { app, db, pid } = setup();
  task(db, {
    project_id: pid,
    title: 'Con fechas',
    start_date: '2026-03-02',
    due_date: '2026-03-06',
  });
  const s1 = task(db, { project_id: pid, title: 'Solo inicio', start_date: '2026-03-02' });
  const s2 = task(db, { project_id: pid, title: 'Sin nada' });
  const d = await gantt(await loginAs(app, 'viewer'), pid);
  assert.deepEqual(
    d.tasks.map((t) => t.name),
    ['Con fechas'],
  );
  assert.deepEqual(
    d.unscheduled.map((t) => [t.id, t.title]).sort(),
    [
      [s1, 'Solo inicio'],
      [s2, 'Sin nada'],
    ].sort(),
  );
  assert.ok('status' in d.unscheduled[0]);
});

test('las dependencias solo se listan entre tareas dibujadas', async () => {
  const { app, db, pid } = setup();
  const a = task(db, {
    project_id: pid,
    title: 'A',
    start_date: '2026-03-02',
    due_date: '2026-03-06',
  });
  const b = task(db, {
    project_id: pid,
    title: 'B',
    start_date: '2026-03-09',
    due_date: '2026-03-13',
  });
  const sinFechas = task(db, { project_id: pid, title: 'Sin fechas' });
  const dep = db.prepare(
    'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)',
  );
  dep.run(b, a);
  dep.run(b, sinFechas);
  const d = await gantt(await loginAs(app, 'viewer'), pid);
  assert.deepEqual(d.tasks.find((t) => t.name === 'B').dependencies, [`t${a}`]);
});

test('hitos como barra de un día con clase milestone y estado', async () => {
  const { app, db, pid } = setup();
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'Entrega beta', '2026-05-15', 'pending')",
  ).run(pid);
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status, completed_at) VALUES (?, 'Kick-off', '2026-03-02', 'completed', '2026-03-02T10:00:00Z')",
  ).run(pid);
  const d = await gantt(await loginAs(app, 'viewer'), pid);
  const ms = d.tasks.filter((t) => t.meta.kind === 'milestone');
  assert.equal(ms.length, 2);
  const beta = ms.find((m) => m.name === 'Entrega beta');
  assert.equal(beta.start, '2026-05-15');
  assert.equal(beta.end, '2026-05-15');
  assert.match(beta.custom_class, /milestone/);
  assert.equal(beta.meta.status, 'pending');
  assert.equal(ms.find((m) => m.name === 'Kick-off').progress, 100);
  assert.equal(beta.progress, 0);
  assert.deepEqual(beta.dependencies, []);
});

test('orden por inicio y agrupación por sprint (backlog al final)', async () => {
  const { app, db, pid } = setup();
  const s1 = sprint(db, {
    project_id: pid,
    name: 'Sprint 1',
    start_date: '2026-03-02',
    end_date: '2026-03-13',
  });
  const s2 = sprint(db, {
    project_id: pid,
    name: 'Sprint 2',
    start_date: '2026-03-16',
    end_date: '2026-03-27',
  });
  task(db, {
    project_id: pid,
    title: 'Tardía S1',
    sprint_id: s1,
    start_date: '2026-03-10',
    due_date: '2026-03-12',
  });
  task(db, {
    project_id: pid,
    title: 'S2',
    sprint_id: s2,
    start_date: '2026-03-16',
    due_date: '2026-03-20',
  });
  task(db, {
    project_id: pid,
    title: 'Temprana S1',
    sprint_id: s1,
    start_date: '2026-03-03',
    due_date: '2026-03-05',
  });
  task(db, { project_id: pid, title: 'Backlog', start_date: '2026-03-02', due_date: '2026-03-03' });
  const v = await loginAs(app, 'viewer');
  const flat = await gantt(v, pid);
  assert.deepEqual(
    flat.tasks.map((t) => t.name),
    ['Backlog', 'Temprana S1', 'Tardía S1', 'S2'],
  );
  assert.equal(flat.groupBy, 'none');
  const grouped = await gantt(v, pid, '?groupBy=sprint');
  assert.equal(grouped.groupBy, 'sprint');
  assert.deepEqual(
    grouped.tasks.map((t) => t.name),
    ['Temprana S1', 'Tardía S1', 'S2', 'Backlog'],
  );
  assert.deepEqual(
    grouped.tasks.map((t) => t.meta.sprintName),
    ['Sprint 1', 'Sprint 1', 'Sprint 2', null],
  );
  assert.equal((await v.get(`/api/v1/projects/${pid}/gantt?groupBy=otro`)).status, 400);
});

test('permisos para reprogramar: la respuesta indica si el usuario puede arrastrar', async () => {
  const { app, db, pid } = setup();
  task(db, { project_id: pid, title: 'T', start_date: '2026-03-02', due_date: '2026-03-06' });
  for (const [role, can] of [
    ['admin', true],
    ['pm', true],
    ['developer', false],
    ['viewer', false],
  ]) {
    assert.equal((await gantt(await loginAs(app, role), pid)).canReschedule, can, role);
  }
});

test('custom_class es un único token (Frappe Gantt lo agrega con classList.add): sin espacios', async () => {
  const { app, db, pid } = setup();
  task(db, {
    project_id: pid,
    title: 'Atrasada',
    start_date: '2026-03-02',
    due_date: '2026-03-06',
    status: 'in_progress',
  });
  task(db, {
    project_id: pid,
    title: 'Hecha',
    start_date: '2026-03-02',
    due_date: '2026-03-06',
    status: 'done',
  });
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'H1', '2026-05-15', 'pending')",
  ).run(pid);
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'H2', '2026-03-02', 'completed')",
  ).run(pid);
  const d = await gantt(await loginAs(app, 'viewer'), pid);
  for (const item of d.tasks)
    assert.doesNotMatch(item.custom_class, /\s/, `${item.name}: ${item.custom_class}`);
  const byName = Object.fromEntries(d.tasks.map((t) => [t.name, t.custom_class]));
  assert.equal(byName.Atrasada, 'gantt-late'); // hoy es 2026-05-13 y no está hecha
  assert.equal(byName.Hecha, 'gantt-done'); // lo terminado nunca es «atrasado»
  assert.equal(byName.H1, 'milestone-pending');
  assert.equal(byName.H2, 'milestone-completed');
});
