import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { createEventBus } from '../../src/realtime/eventBus.js';
import { setClock } from '../../src/lib/dates.js';
import {
  user,
  teamMember,
  internalClient,
  project,
  sprint,
  task,
  assignment,
  timeEntry,
} from '../helpers/factories.js';

// ARQUITECTURA §4: cada service que modifica datos que alimentan KPIs emite un evento de dominio
// después de confirmar la transacción.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  user(db, { email: 'lead@test.local', password_hash: hash, role: 'pm', team_member_id: lead });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  const pid = project(db, { manager_id: lead, start_date: '2026-01-05', end_date: '2026-12-18' });
  assignment(db, {
    project_id: pid,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-06-30',
  });
  const bus = createEventBus();
  const events = [];
  bus.subscribe((e) => events.push(e));
  const app = buildTestApp({ db, eventBus: bus });
  return { db, dev, lead, pid, app, events };
}
async function login(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
const types = (events) => events.map((e) => e.type);

test('proyectos: crear, editar y cambiar de estado', async () => {
  const { app, db, events } = setup();
  const admin = await login(app, 'admin');
  const cid = internalClient(db);
  const created = await admin
    .post('/api/v1/projects')
    .send({ name: 'P', clientId: cid, startDate: '2026-02-02', endDate: '2026-08-28' });
  const id = created.body.data.id;
  await admin.patch(`/api/v1/projects/${id}`).send({ name: 'P2' });
  await admin.post(`/api/v1/projects/${id}/status`).send({ status: 'active' });
  assert.deepEqual(types(events), ['project.created', 'project.updated', 'project.status_changed']);
  assert.ok(events.every((e) => e.projectId === id && Number.isInteger(e.id) && e.at));
});

test('hitos y asignaciones', async () => {
  const { app, db, events, pid, lead } = setup();
  const admin = await login(app, 'admin');
  const ms = await admin
    .post(`/api/v1/projects/${pid}/milestones`)
    .send({ name: 'M', dueDate: '2026-05-30' });
  await admin
    .patch(`/api/v1/projects/${pid}/milestones/${ms.body.data.id}`)
    .send({ status: 'completed' });
  await admin.delete(`/api/v1/projects/${pid}/milestones/${ms.body.data.id}`);
  const asg = await admin.post(`/api/v1/projects/${pid}/assignments`).send({
    teamMemberId: lead,
    projectRole: 'Líder',
    allocationPercent: 50,
    startDate: '2026-04-01',
    endDate: '2026-06-30',
  });
  await admin
    .patch(`/api/v1/projects/${pid}/assignments/${asg.body.data.id}`)
    .send({ allocationPercent: 40 });
  await admin.delete(`/api/v1/projects/${pid}/assignments/${asg.body.data.id}`);
  assert.deepEqual(types(events), [
    'milestone.updated',
    'milestone.updated',
    'milestone.updated',
    'assignment.changed',
    'assignment.changed',
    'assignment.changed',
  ]);
  assert.equal(events.at(-1).teamMemberId, lead);
  assert.equal(
    db.prepare('SELECT count(*) FROM assignments WHERE team_member_id = ?').pluck().get(lead),
    0,
  );
});

test('sprints: crear, iniciar y cerrar', async () => {
  const { app, events, pid } = setup();
  const admin = await login(app, 'admin');
  const sp = await admin
    .post(`/api/v1/projects/${pid}/sprints`)
    .send({ name: 'S1', startDate: '2026-05-11', endDate: '2026-05-22' });
  const id = sp.body.data.id;
  await admin.post(`/api/v1/sprints/${id}/start`).send({});
  await admin.post(`/api/v1/sprints/${id}/close`).send({});
  assert.deepEqual(types(events), ['sprint.updated', 'sprint.started', 'sprint.closed']);
  assert.ok(events.every((e) => e.sprintId === id && e.projectId === pid));
});

test('tareas: crear, editar, cambiar estado, dependencias, reordenar y eliminar', async () => {
  const { app, db, events, pid } = setup();
  const admin = await login(app, 'admin');
  const a = (await admin.post(`/api/v1/projects/${pid}/tasks`).send({ title: 'A' })).body.data.id;
  const b = task(db, { project_id: pid });
  await admin.patch(`/api/v1/tasks/${a}`).send({ title: 'A2' });
  await admin.post(`/api/v1/tasks/${a}/status`).send({ status: 'in_progress' });
  await admin.post(`/api/v1/tasks/${a}/dependencies`).send({ dependsOnTaskId: b });
  await admin.delete(`/api/v1/tasks/${a}/dependencies/${b}`);
  await admin.put(`/api/v1/projects/${pid}/tasks/order`).send({ taskIds: [b, a] });
  await admin.delete(`/api/v1/tasks/${a}`);
  assert.deepEqual(types(events), [
    'task.created',
    'task.updated',
    'task.status_changed',
    'task.updated',
    'task.updated',
    'task.updated',
    'task.deleted',
  ]);
  assert.ok(events.every((e) => e.projectId === pid));
  assert.equal(events[0].taskId, a);
});

test('tiempo: registrar, enviar, aprobar, rechazar, facturable y eliminar', async () => {
  const { app, events, pid } = setup();
  const dev = await login(app, 'dev');
  const lead = await login(app, 'lead');
  const mk = async (workDate) =>
    (
      await dev
        .post('/api/v1/time-entries')
        .send({ projectId: pid, workDate, minutes: 60, description: 'x' })
    ).body.data.id;
  const a = await mk('2026-05-11');
  const b = await mk('2026-05-12');
  await dev.post(`/api/v1/time-entries/${a}/submit`).send({});
  await dev.post(`/api/v1/time-entries/${b}/submit`).send({});
  await lead.post(`/api/v1/time-entries/${a}/approve`).send({});
  await lead.post(`/api/v1/time-entries/${b}/reject`).send({ reason: 'detalla' });
  await lead.patch(`/api/v1/time-entries/${a}/billable`).send({ isBillable: true }); // el proyecto no es facturable: hay cambio
  await dev.patch(`/api/v1/time-entries/${b}`).send({ minutes: 90 });
  await dev.delete(`/api/v1/time-entries/${b}`);
  assert.deepEqual(types(events), [
    'time_entry.changed',
    'time_entry.changed', // crear ×2
    'time_entry.changed',
    'time_entry.changed', // enviar ×2
    'time_entry.approved',
    'time_entry.changed', // aprobar, rechazar
    'time_entry.changed',
    'time_entry.changed',
    'time_entry.changed', // facturable, editar, eliminar
  ]);
  assert.ok(events.every((e) => e.projectId === pid && e.memberId));
});

test('enviar la semana emite un evento con el miembro; sin registros por enviar no emite', async () => {
  const { app, events, pid } = setup();
  const dev = await login(app, 'dev');
  await dev
    .post('/api/v1/time-entries')
    .send({ projectId: pid, workDate: '2026-05-11', minutes: 60, description: 'x' });
  events.length = 0;
  await dev.post('/api/v1/time-entries/submit-week').send({ week: '2026-05-13' });
  await dev.post('/api/v1/time-entries/submit-week').send({ week: '2026-05-13' }); // ya enviado
  assert.deepEqual(types(events), ['time_entry.changed']);
});

test('equipo, ausencias y clientes', async () => {
  const { app, events } = setup();
  const admin = await login(app, 'admin');
  const m = await admin.post('/api/v1/team-members').send({
    firstName: 'Z',
    lastName: 'Y',
    email: 'zy@test.local',
    position: 'qa',
    seniority: 'mid',
  });
  await admin.patch(`/api/v1/team-members/${m.body.data.id}`).send({ seniority: 'senior' });
  const off = await admin
    .post(`/api/v1/team-members/${m.body.data.id}/time-off`)
    .send({ type: 'vacation', startDate: '2026-07-06', endDate: '2026-07-10' });
  await admin
    .patch(`/api/v1/team-members/${m.body.data.id}/time-off/${off.body.data.id}`)
    .send({ notes: 'x' });
  await admin.delete(`/api/v1/team-members/${m.body.data.id}/time-off/${off.body.data.id}`);
  const c = await admin
    .post('/api/v1/clients')
    .send({ type: 'internal', name: 'RH', department: 'RH' });
  await admin.patch(`/api/v1/clients/${c.body.data.id}`).send({ isActive: false });
  assert.deepEqual(types(events), [
    'team_member.updated',
    'team_member.updated',
    'time_off.changed',
    'time_off.changed',
    'time_off.changed',
    'client.updated',
    'client.updated',
  ]);
});

test('operaciones rechazadas (validación, permisos, reglas) no emiten eventos', async () => {
  const { app, events, pid, db } = setup();
  const admin = await login(app, 'admin');
  const dev = await login(app, 'dev');
  const t = task(db, {
    project_id: pid,
    status: 'done',
    sprint_id: sprint(db, { project_id: pid, status: 'closed' }),
  });
  assert.equal((await admin.post(`/api/v1/projects/${pid}/tasks`).send({ title: '' })).status, 400);
  assert.equal(
    (await admin.post(`/api/v1/tasks/${t}/status`).send({ status: 'todo' })).status,
    422,
  );
  assert.equal((await dev.post(`/api/v1/projects/${pid}/tasks`).send({ title: 'x' })).status, 403);
  assert.equal((await admin.patch(`/api/v1/projects/${pid}`).send({})).status, 400);
  assert.equal(
    (
      await dev
        .post('/api/v1/time-entries')
        .send({ projectId: pid, workDate: '2026-05-30', minutes: 60, description: 'futuro' })
    ).status,
    422,
  );
  assert.deepEqual(events, []);
});

test('un cambio de estado al mismo valor no emite (arrastre sin efecto)', async () => {
  const { app, events, pid, db } = setup();
  const admin = await login(app, 'admin');
  const t = task(db, { project_id: pid, status: 'todo' });
  await admin.post(`/api/v1/tasks/${t}/status`).send({ status: 'todo' });
  assert.deepEqual(events, []);
});
