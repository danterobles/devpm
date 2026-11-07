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
  project,
  sprint,
  task,
  assignment,
  milestone,
} from '../helpers/factories.js';

// Recorrido de los criterios de aceptación del MVP (PRD §8). Los criterios 2 a 5 se verifican de punta a
// punta en `acceptance-kpis.test.js`; aquí se cubren el 1 y el 6 y se deja el mapa completo.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

test('§8.1 — un pm crea un cliente externo, un proyecto, asigna 3 miembros, crea un sprint con tareas y las ve en el Gantt y el Kanban', async () => {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  const app = buildTestApp({ db });
  const pm = await loginAs(app, 'pm');

  // Cliente externo y proyecto para ese cliente
  const client = await pm.post('/api/v1/clients').send({
    type: 'external',
    name: 'Globex',
    legalName: 'Globex SA de CV',
    taxId: 'GLO010101AAA',
    hourlyRateCents: 90000,
  });
  assert.equal(client.status, 201);
  const created = await pm.post('/api/v1/projects').send({
    name: 'Portal de clientes',
    clientId: client.body.data.id,
    startDate: '2026-05-04',
    endDate: '2026-08-28',
    budgetMinutes: 60000,
  });
  assert.equal(created.status, 201);
  const proj = created.body.data;
  assert.equal(proj.isBillable, true); // cliente externo ⇒ facturable
  assert.match(proj.code, /^PRJ-2026-\d{3}$/);

  // Tres miembros asignados
  const memberIds = [];
  for (const [first, last, position] of [
    ['Ana', 'Ruiz', 'backend'],
    ['Beto', 'Luna', 'frontend'],
    ['Carla', 'Soto', 'qa'],
  ]) {
    const m = await pm.post('/api/v1/team-members').send({
      firstName: first,
      lastName: last,
      email: `${first.toLowerCase()}@equipo.test`,
      position,
      seniority: 'mid',
    });
    assert.equal(m.status, 201);
    memberIds.push(m.body.data.id);
    const asg = await pm.post(`/api/v1/projects/${proj.id}/assignments`).send({
      teamMemberId: m.body.data.id,
      projectRole: position,
      allocationPercent: 50,
      startDate: '2026-05-04',
      endDate: '2026-08-28',
    });
    assert.equal(asg.status, 201);
    assert.deepEqual(asg.body.warnings, []);
  }
  assert.equal((await pm.get(`/api/v1/projects/${proj.id}/assignments`)).body.data.length, 3);

  // Sprint con tareas (con fechas y responsables)
  const sp = (
    await pm
      .post(`/api/v1/projects/${proj.id}/sprints`)
      .send({ name: 'Sprint 1', goal: 'MVP', startDate: '2026-05-11', endDate: '2026-05-22' })
  ).body.data;
  const titles = ['Diseñar modelo', 'Implementar login', 'Pruebas de aceptación'];
  const taskIds = [];
  for (const [i, title] of titles.entries()) {
    const t = await pm.post(`/api/v1/projects/${proj.id}/tasks`).send({
      title,
      storyPoints: [3, 5, 8][i],
      estimatedMinutes: 480,
      assigneeId: memberIds[i],
      sprintId: sp.id,
      startDate: `2026-05-${String(11 + i * 2).padStart(2, '0')}`,
      dueDate: `2026-05-${String(12 + i * 2).padStart(2, '0')}`,
    });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    taskIds.push(t.body.data.id);
  }
  assert.equal(
    (await pm.post(`/api/v1/sprints/${sp.id}/start`).send({})).body.data.committedPoints,
    16, // 3 + 5 + 8 puntos
  );

  // Se ven en el Gantt (datos y página)
  const gantt = (await pm.get(`/api/v1/projects/${proj.id}/gantt`)).body.data;
  assert.deepEqual(
    gantt.tasks.map((t) => t.name),
    titles,
  );
  assert.equal(gantt.canReschedule, true);
  assert.equal((await pm.get(`/projects/${proj.id}/gantt`)).status, 200);

  // …y en el tablero Kanban (datos y página)
  const board = (await pm.get(`/api/v1/sprints/${sp.id}/board`)).body.data;
  assert.deepEqual(
    board.columns.find((c) => c.status === 'todo').tasks.map((t) => t.title),
    titles,
  );
  const page = await pm.get(`/projects/${proj.id}/sprints/${sp.id}/board`);
  assert.equal(page.status, 200);
  for (const title of titles) assert.match(page.text, new RegExp(title));
  assert.equal(taskIds.length, 3);
});

test('§8.6 — un viewer no puede crear ni modificar información: 403 en la API y controles ocultos en la UI', async () => {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  const member = teamMember(db);
  const pid = project(db, {
    client_id: internalClient(db),
    start_date: '2026-03-02',
    end_date: '2026-08-28',
  });
  assignment(db, {
    project_id: pid,
    team_member_id: member,
    start_date: '2026-03-02',
    end_date: '2026-08-28',
  });
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
  });
  const t = task(db, { project_id: pid, sprint_id: sid, assignee_id: member, status: 'todo' });
  const ms = milestone(db, { project_id: pid });
  const app = buildTestApp({ db });
  const viewer = await loginAs(app, 'viewer');

  // API: ninguna escritura se permite
  const writes = [
    ['post', '/api/v1/clients', { type: 'internal', name: 'X', department: 'Y' }],
    ['patch', '/api/v1/clients/1', { name: 'X' }],
    [
      'post',
      '/api/v1/team-members',
      { firstName: 'A', lastName: 'B', email: 'a@b.co', position: 'qa', seniority: 'mid' },
    ],
    ['patch', `/api/v1/team-members/${member}`, { seniority: 'lead' }],
    ['post', `/api/v1/team-members/${member}/skills`, { name: 'Node', level: 3 }],
    [
      'post',
      `/api/v1/team-members/${member}/time-off`,
      { type: 'vacation', startDate: '2026-07-06', endDate: '2026-07-10' },
    ],
    [
      'post',
      '/api/v1/projects',
      { name: 'P', clientId: 1, startDate: '2026-01-05', endDate: '2026-02-05' },
    ],
    ['patch', `/api/v1/projects/${pid}`, { name: 'Otro' }],
    ['post', `/api/v1/projects/${pid}/status`, { status: 'on_hold' }],
    ['post', `/api/v1/projects/${pid}/milestones`, { name: 'H', dueDate: '2026-06-01' }],
    ['patch', `/api/v1/projects/${pid}/milestones/${ms}`, { status: 'completed' }],
    [
      'post',
      `/api/v1/projects/${pid}/assignments`,
      {
        teamMemberId: member,
        projectRole: 'x',
        allocationPercent: 10,
        startDate: '2026-04-01',
        endDate: '2026-04-30',
      },
    ],
    [
      'post',
      `/api/v1/projects/${pid}/sprints`,
      { name: 'S', startDate: '2026-06-01', endDate: '2026-06-12' },
    ],
    ['post', `/api/v1/sprints/${sid}/close`, {}],
    ['post', `/api/v1/projects/${pid}/tasks`, { title: 'T' }],
    ['patch', `/api/v1/tasks/${t}`, { title: 'Otro' }],
    ['post', `/api/v1/tasks/${t}/status`, { status: 'done' }],
    ['delete', `/api/v1/tasks/${t}`],
    ['post', `/api/v1/tasks/${t}/dependencies`, { dependsOnTaskId: 1 }],
    ['put', `/api/v1/projects/${pid}/tasks/order`, { taskIds: [t] }],
    [
      'post',
      '/api/v1/time-entries',
      { projectId: pid, workDate: '2026-05-12', minutes: 60, description: 'x' },
    ],
    [
      'post',
      '/api/v1/users',
      { email: 'x@y.co', fullName: 'X', role: 'viewer', password: 'password-1' },
    ],
    ['put', '/api/v1/settings/kpi-thresholds', {}],
  ];
  for (const [method, url, body] of writes) {
    const res = await viewer[method](url).send(body);
    assert.equal(res.status, 403, `${method.toUpperCase()} ${url} → ${res.status}`);
  }
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').pluck().get(t), 'todo'); // nada cambió

  // UI: sin botones ni formularios de escritura
  const hidden = [
    ['/clients/internal', ['/clients/internal/new']],
    ['/team', ['/team/new']],
    [`/team/${member}`, ['>Guardar<', 'name="startDate"', 'name="level"']],
    ['/projects', ['/projects/new']],
    [`/projects/${pid}`, ['>Guardar<', 'name="dueDate"', 'name="allocationPercent"', '/status"']],
    [`/projects/${pid}/backlog`, ['name="title"', '>Subir<']],
    [`/projects/${pid}/sprints`, ['name="startDate"', 'Iniciar', 'Cerrar sprint']],
    [`/projects/${pid}/sprints/${sid}/board`, ['>Mover<', 'data-can-move="true"']],
    [`/tasks/${t}`, ['>Guardar<', 'name="dependsOnTaskId"', 'Eliminar tarea', '/status"']],
    ['/dashboard', ['Configurar umbrales']],
  ];
  for (const [url, forbidden] of hidden) {
    const res = await viewer.get(url);
    assert.equal(res.status, 200, url);
    for (const text of forbidden)
      assert.ok(!res.text.includes(text), `${url} no debe mostrar «${text}» a un viewer`);
  }
  // el menú no ofrece administración ni registro de tiempo
  const nav = (await viewer.get('/dashboard')).text;
  assert.ok(!nav.includes('href="/admin/users"'));
  assert.ok(!nav.includes('href="/time"'));
});
