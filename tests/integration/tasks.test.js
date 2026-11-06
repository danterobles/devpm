import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, sprint, task, assignment } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  const devMember = teamMember(db, { first_name: 'Dev', last_name: 'Uno' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  user(db, {
    email: 'developer@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: devMember,
  });
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  assignment(db, { project_id: pid, team_member_id: devMember });
  return { db, pid, devMember, app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const url = (pid) => `/api/v1/projects/${pid}/tasks`;
const tk = (o = {}) => ({ title: 'Implementar login', ...o });

afterEach(() => setClock(() => new Date()));

test('tareas: 401 sin sesión; leen todos; crear/editar/borrar solo admin y pm', async () => {
  const { app, db, pid } = setup();
  const id = task(db, { project_id: pid });
  assert.equal((await request(app).get(url(pid))).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.get(url(pid))).status, 200, role);
    assert.equal((await a.get(`/api/v1/tasks/${id}`)).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post(url(pid)).send(tk())).status, 403, role);
    assert.equal((await a.patch(`/api/v1/tasks/${id}`).send({ title: 'x' })).status, 403, role);
    assert.equal((await a.delete(`/api/v1/tasks/${id}`)).status, 403, role);
  }
});

test('crear tarea: 201 en backlog con valores por defecto, historial inicial y bitácora', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(url(pid)).send(
    tk({
      description: 'OAuth',
      storyPoints: 5,
      estimatedMinutes: 480,
      startDate: '2026-02-02',
      dueDate: '2026-02-06',
    }),
  );
  assert.equal(res.status, 201);
  const t = res.body.data;
  assert.equal(t.status, 'backlog');
  assert.equal(t.type, 'feature');
  assert.equal(t.priority, 'medium');
  assert.equal(t.sprintId, null);
  assert.equal(t.storyPoints, 5);
  assert.equal(t.startedAt, null);
  assert.equal(t.completedAt, null);
  const hist = db
    .prepare('SELECT from_status, to_status FROM task_status_history WHERE task_id = ?')
    .get(t.id);
  assert.deepEqual({ ...hist }, { from_status: null, to_status: 'backlog' });
  assert.equal(db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'task'").pluck().get(), 1);
  const second = await pm.post(url(pid)).send(tk({ title: 'Otra' }));
  assert.equal(second.body.data.sortOrder > t.sortOrder, true);
});

test('validación de tareas', async () => {
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  for (const b of [
    tk({ title: ' ' }),
    tk({ type: 'epic' }),
    tk({ priority: 'urgent' }),
    tk({ storyPoints: 4 }),
    tk({ storyPoints: 'cinco' }),
    tk({ estimatedMinutes: -1 }),
    tk({ estimatedMinutes: 1.5 }),
    tk({ startDate: '2026-02-30' }),
    tk({ startDate: '2026-02-10', dueDate: '2026-02-01' }),
    tk({ status: 'done' }),
    tk({ extra: 1 }),
  ]) {
    assert.equal((await pm.post(url(pid)).send(b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await pm.post(url(9999)).send(tk())).status, 404);
  for (const points of [0, 1, 2, 3, 5, 8, 13, 21]) {
    assert.equal(
      (await pm.post(url(pid)).send(tk({ storyPoints: points }))).status,
      201,
      String(points),
    );
  }
});

test('RF-42: el responsable debe estar asignado al proyecto', async () => {
  const { app, db, pid, devMember } = setup();
  const pm = await loginAs(app, 'pm');
  const outsider = teamMember(db);
  const rejected = await pm.post(url(pid)).send(tk({ assigneeId: outsider }));
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error.code, 'BUSINESS_RULE');
  assert.equal((await pm.post(url(pid)).send(tk({ assigneeId: 9999 }))).status, 422);
  const ok = await pm.post(url(pid)).send(tk({ assigneeId: devMember }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.assigneeName, 'Dev Uno');
  const id = ok.body.data.id;
  assert.equal((await pm.patch(`/api/v1/tasks/${id}`).send({ assigneeId: outsider })).status, 422);
  assert.equal(
    (await pm.patch(`/api/v1/tasks/${id}`).send({ assigneeId: null })).body.data.assigneeId,
    null,
  );
});

test('sprint e hito deben ser del mismo proyecto; sprint cerrado no admite tareas; entrar a sprint pasa backlog → todo', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const planned = sprint(db, { project_id: pid, start_date: '2026-02-02', end_date: '2026-02-13' });
  const closed = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-01-12',
    end_date: '2026-01-23',
  });
  const foreignSprint = sprint(db, { project_id: project(db) });
  const ms = db
    .prepare("INSERT INTO milestones (project_id, name, due_date) VALUES (?, 'M', '2026-03-01')")
    .run(pid).lastInsertRowid;
  const foreignMs = db
    .prepare("INSERT INTO milestones (project_id, name, due_date) VALUES (?, 'M', '2026-03-01')")
    .run(project(db)).lastInsertRowid;
  assert.equal((await pm.post(url(pid)).send(tk({ sprintId: foreignSprint }))).status, 422);
  assert.equal((await pm.post(url(pid)).send(tk({ sprintId: closed }))).status, 422);
  assert.equal((await pm.post(url(pid)).send(tk({ sprintId: 9999 }))).status, 422);
  assert.equal((await pm.post(url(pid)).send(tk({ milestoneId: Number(foreignMs) }))).status, 422);
  const ok = await pm.post(url(pid)).send(tk({ sprintId: planned, milestoneId: Number(ms) }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.status, 'todo');
  assert.equal(ok.body.data.milestoneId, Number(ms));
  const hist = db
    .prepare('SELECT to_status FROM task_status_history WHERE task_id = ?')
    .pluck()
    .get(ok.body.data.id);
  assert.equal(hist, 'todo');
});

test('mover entre backlog y sprint: backlog→todo al entrar; vuelve a backlog al salir; done no sale', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const sid = sprint(db, { project_id: pid, start_date: '2026-02-02', end_date: '2026-02-13' });
  const id = (await pm.post(url(pid)).send(tk())).body.data.id;
  const into = await pm.patch(`/api/v1/tasks/${id}`).send({ sprintId: sid });
  assert.equal(into.body.data.sprintId, sid);
  assert.equal(into.body.data.status, 'todo');
  await pm.post(`/api/v1/tasks/${id}/status`).send({ status: 'in_progress' });
  const out = await pm.patch(`/api/v1/tasks/${id}`).send({ sprintId: null });
  assert.equal(out.body.data.sprintId, null);
  assert.equal(out.body.data.status, 'backlog');
  const seq = db
    .prepare('SELECT to_status FROM task_status_history WHERE task_id = ? ORDER BY id')
    .pluck()
    .all(id);
  assert.deepEqual(seq, ['backlog', 'todo', 'in_progress', 'backlog']);
  // una tarea done no se saca de su sprint
  await pm.patch(`/api/v1/tasks/${id}`).send({ sprintId: sid });
  await pm.post(`/api/v1/tasks/${id}/status`).send({ status: 'done' });
  assert.equal((await pm.patch(`/api/v1/tasks/${id}`).send({ sprintId: null })).status, 422);
});

test('RF-62: cambios de estado libres con historial, started_at y completed_at', async () => {
  setClock(() => new Date('2026-03-10T12:00:00.000Z'));
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const id = (await pm.post(url(pid)).send(tk())).body.data.id;
  const status = (s) => pm.post(`/api/v1/tasks/${id}/status`).send({ status: s });
  const a = await status('in_progress');
  assert.equal(a.status, 200);
  assert.equal(a.body.data.startedAt, '2026-03-10T12:00:00.000Z');
  setClock(() => new Date('2026-03-12T12:00:00.000Z'));
  await status('blocked');
  const again = await status('in_progress');
  assert.equal(again.body.data.startedAt, '2026-03-10T12:00:00.000Z'); // solo la primera vez
  const done = await status('done');
  assert.equal(done.body.data.completedAt, '2026-03-12T12:00:00.000Z');
  const reopened = await status('todo');
  assert.equal(reopened.body.data.completedAt, null);
  const same = await status('todo'); // arrastre sin cambio: no duplica historial
  assert.equal(same.status, 200);
  const seq = db
    .prepare('SELECT from_status, to_status FROM task_status_history WHERE task_id = ? ORDER BY id')
    .all(id);
  assert.deepEqual(
    seq.map((r) => [r.from_status, r.to_status]),
    [
      [null, 'backlog'],
      ['backlog', 'in_progress'],
      ['in_progress', 'blocked'],
      ['blocked', 'in_progress'],
      ['in_progress', 'done'],
      ['done', 'todo'],
    ],
  );
  const hist = await pm.get(`/api/v1/tasks/${id}/history`);
  assert.equal(hist.body.data.length, 6);
  assert.equal(hist.body.data[0].toStatus, 'backlog');
  assert.equal((await status('archivado')).status, 400);
  assert.equal((await pm.post(`/api/v1/tasks/${id}/status`).send({})).status, 400);
  assert.equal((await pm.post('/api/v1/tasks/9999/status').send({ status: 'done' })).status, 404);
});

test('developer solo cambia el estado de SUS tareas; viewer nunca', async () => {
  const { app, db, pid, devMember } = setup();
  const mine = task(db, { project_id: pid, assignee_id: devMember });
  const other = teamMember(db);
  assignment(db, { project_id: pid, team_member_id: other });
  const theirs = task(db, { project_id: pid, assignee_id: other });
  const unassigned = task(db, { project_id: pid });
  const dev = await loginAs(app, 'developer');
  assert.equal(
    (await dev.post(`/api/v1/tasks/${mine}/status`).send({ status: 'in_progress' })).status,
    200,
  );
  assert.equal(
    (await dev.post(`/api/v1/tasks/${theirs}/status`).send({ status: 'in_progress' })).status,
    403,
  );
  assert.equal(
    (await dev.post(`/api/v1/tasks/${unassigned}/status`).send({ status: 'in_progress' })).status,
    403,
  );
  assert.equal((await dev.patch(`/api/v1/tasks/${mine}`).send({ title: 'Renombrar' })).status, 403);
  assert.equal(
    (
      await (
        await loginAs(app, 'viewer')
      )
        .post(`/api/v1/tasks/${mine}/status`)
        .send({ status: 'done' })
    ).status,
    403,
  );
  assert.equal(
    (
      await (
        await loginAs(app, 'pm')
      )
        .post(`/api/v1/tasks/${theirs}/status`)
        .send({ status: 'done' })
    ).status,
    200,
  );
  // el cambio del developer queda atribuido a su usuario en el historial
  const row = db
    .prepare(
      "SELECT changed_by FROM task_status_history WHERE task_id = ? AND to_status = 'in_progress'",
    )
    .get(mine);
  assert.ok(row.changed_by);
});

test('listado: filtros, backlog, búsqueda y paginación', async () => {
  const { app, db, pid, devMember } = setup();
  const sid = sprint(db, { project_id: pid });
  task(db, {
    project_id: pid,
    title: 'Login',
    sprint_id: sid,
    status: 'todo',
    assignee_id: devMember,
    type: 'feature',
    priority: 'high',
  });
  task(db, { project_id: pid, title: 'Bug de pagos', type: 'bug' });
  task(db, { project_id: pid, title: 'Refactor', status: 'done', sprint_id: sid, type: 'chore' });
  const v = await loginAs(app, 'viewer');
  const get = async (qs) => (await v.get(`${url(pid)}${qs}`)).body;
  assert.equal((await get('')).meta.total, 3);
  assert.equal((await get(`?sprintId=${sid}`)).meta.total, 2);
  assert.deepEqual(
    (await get('?backlog=true')).data.map((t) => t.title),
    ['Bug de pagos'],
  );
  assert.equal((await get('?status=done')).meta.total, 1);
  assert.equal((await get(`?assigneeId=${devMember}`)).meta.total, 1);
  assert.equal((await get('?type=bug')).meta.total, 1);
  assert.equal((await get('?priority=high')).meta.total, 1);
  assert.deepEqual(
    (await get('?q=pagos')).data.map((t) => t.title),
    ['Bug de pagos'],
  );
  assert.equal((await get('?pageSize=2&page=2')).data.length, 1);
  assert.equal((await v.get(`${url(pid)}?status=raro`)).status, 400);
  assert.equal((await v.get(url(9999))).status, 404);
});

test('editar: parcial, valida fechas combinadas, bitácora; vacío o status 400; 404', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const id = (await pm.post(url(pid)).send(tk({ startDate: '2026-02-02', dueDate: '2026-02-06' })))
    .body.data.id;
  const res = await pm
    .patch(`/api/v1/tasks/${id}`)
    .send({ title: 'Nuevo', priority: 'critical', storyPoints: 8, description: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Nuevo');
  assert.equal(res.body.data.priority, 'critical');
  assert.equal(res.body.data.storyPoints, 8);
  assert.equal((await pm.patch(`/api/v1/tasks/${id}`).send({ dueDate: '2026-01-01' })).status, 400);
  assert.equal((await pm.patch(`/api/v1/tasks/${id}`).send({})).status, 400);
  assert.equal((await pm.patch(`/api/v1/tasks/${id}`).send({ status: 'done' })).status, 400);
  assert.equal((await pm.patch(`/api/v1/tasks/${id}`).send({ parentTaskId: 1 })).status, 400);
  assert.equal((await pm.patch('/api/v1/tasks/9999').send({ title: 'x' })).status, 404);
  const audit = db
    .prepare(
      "SELECT changes FROM audit_log WHERE entity = 'task' AND entity_id = ? AND action = 'update'",
    )
    .pluck()
    .get(id);
  assert.ok(JSON.parse(audit).title);
});

test('una tarea en un sprint cerrado es de solo lectura (edición y estado 422)', async () => {
  const { app, db, pid } = setup();
  const closed = sprint(db, { project_id: pid, status: 'closed' });
  const id = task(db, { project_id: pid, sprint_id: closed, status: 'done' });
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.patch(`/api/v1/tasks/${id}`).send({ title: 'x' })).status, 422);
  assert.equal((await pm.post(`/api/v1/tasks/${id}/status`).send({ status: 'todo' })).status, 422);
});

test('eliminar tarea: 204/404 y registra bitácora', async () => {
  const { app, db, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const id = (await pm.post(url(pid)).send(tk())).body.data.id;
  assert.equal((await pm.delete(`/api/v1/tasks/${id}`)).status, 204);
  assert.equal((await pm.delete(`/api/v1/tasks/${id}`)).status, 404);
  assert.equal(
    db
      .prepare("SELECT count(*) FROM audit_log WHERE entity = 'task' AND action = 'delete'")
      .pluck()
      .get(),
    1,
  );
});
