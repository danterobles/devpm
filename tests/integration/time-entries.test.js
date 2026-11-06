import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, task, assignment, timeEntry } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

// Miércoles 13 de mayo de 2026 (mediodía UTC): «hoy» en México.
const freeze = () => setClock(() => new Date('2026-05-13T18:00:00Z'));
afterEach(() => setClock(() => new Date()));

function setup() {
  freeze();
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const dev2 = teamMember(db, { first_name: 'Beto', last_name: 'Luna' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  user(db, {
    email: 'dev2@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev2,
  });
  user(db, { email: 'nolink@test.local', password_hash: hash, role: 'developer' });
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18', is_billable: 1 });
  assignment(db, {
    project_id: pid,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-06-30',
  });
  assignment(db, {
    project_id: pid,
    team_member_id: dev2,
    start_date: '2026-03-01',
    end_date: '2026-06-30',
  });
  return { db, pid, dev, dev2, app: buildTestApp({ db }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
const body = (pid, o = {}) => ({
  projectId: pid,
  workDate: '2026-05-12',
  minutes: 120,
  description: 'Implementación del login',
  ...o,
});

test('permisos: 401 sin sesión; viewer 403; sin miembro vinculado 403; developer/pm/admin con miembro crean', async () => {
  const { app, pid } = setup();
  assert.equal((await request(app).get('/api/v1/time-entries')).status, 401);
  assert.equal((await request(app).post('/api/v1/time-entries').send(body(pid))).status, 401);
  assert.equal((await (await loginAs(app, 'viewer')).get('/api/v1/time-entries')).status, 403);
  assert.equal(
    (await (await loginAs(app, 'viewer')).post('/api/v1/time-entries').send(body(pid))).status,
    403,
  );
  const nolink = await loginAs(app, 'nolink');
  const res = await nolink.post('/api/v1/time-entries').send(body(pid));
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /miembro/i);
  assert.equal(
    (await (await loginAs(app, 'dev')).post('/api/v1/time-entries').send(body(pid))).status,
    201,
  );
});

test('crear: 201 en draft, hereda is_billable del proyecto, asigna al miembro vinculado y deja bitácora', async () => {
  const { app, db, pid, dev } = setup();
  const res = await (await loginAs(app, 'dev')).post('/api/v1/time-entries').send(body(pid));
  assert.equal(res.status, 201);
  const e = res.body.data;
  assert.equal(e.status, 'draft');
  assert.equal(e.teamMemberId, dev);
  assert.equal(e.memberName, 'Ana Ruiz');
  assert.equal(e.minutes, 120);
  assert.equal(e.isBillable, true);
  assert.equal(e.workDate, '2026-05-12');
  assert.equal(e.projectId, pid);
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'time_entry'").pluck().get(),
    1,
  );
  const nonBillable = project(db, {
    is_billable: 0,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  assignment(db, {
    project_id: nonBillable,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-06-30',
  });
  const nb = await (await loginAs(app, 'dev')).post('/api/v1/time-entries').send(body(nonBillable));
  assert.equal(nb.body.data.isBillable, false);
});

test('validación de formato (RF-53): duración, fecha, descripción y campos desconocidos', async () => {
  const { app, pid } = setup();
  const dev = await loginAs(app, 'dev');
  for (const b of [
    body(pid, { minutes: 0 }),
    body(pid, { minutes: -5 }),
    body(pid, { minutes: 1441 }),
    body(pid, { minutes: 90.5 }),
    body(pid, { minutes: '120' }),
    body(pid, { workDate: '2026-02-30' }),
    body(pid, { workDate: '12/05/2026' }),
    body(pid, { description: '  ' }),
    body(pid, { projectId: undefined }),
    body(pid, { isBillable: false }),
    body(pid, { teamMemberId: 1 }),
    body(pid, { status: 'approved' }),
  ]) {
    const res = await dev.post('/api/v1/time-entries').send(b);
    assert.equal(res.status, 400, JSON.stringify(b));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('RF-53: no se registran fechas futuras (zona horaria de la aplicación)', async () => {
  const { app, pid } = setup();
  const dev = await loginAs(app, 'dev');
  const future = await dev.post('/api/v1/time-entries').send(body(pid, { workDate: '2026-05-14' }));
  assert.equal(future.status, 422);
  assert.equal(future.body.error.code, 'BUSINESS_RULE');
  assert.equal(
    (await dev.post('/api/v1/time-entries').send(body(pid, { workDate: '2026-05-13' }))).status,
    201,
  ); // hoy
  // 02:00 UTC del día 14 sigue siendo el 13 en México: el 14 aún es futuro
  setClock(() => new Date('2026-05-14T02:00:00Z'));
  assert.equal(
    (await dev.post('/api/v1/time-entries').send(body(pid, { workDate: '2026-05-14' }))).status,
    422,
  );
});

test('RF-53: no más de 24 h por miembro y día, entre todos los proyectos y estados', async () => {
  const { app, db, pid, dev } = setup();
  const other = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  assignment(db, {
    project_id: other,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-06-30',
  });
  const d = await loginAs(app, 'dev');
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(pid, { minutes: 600 }))).status,
    201,
  );
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(other, { minutes: 800 }))).status,
    201,
  ); // 1400
  const over = await d.post('/api/v1/time-entries').send(body(pid, { minutes: 41 }));
  assert.equal(over.status, 422);
  assert.match(over.body.error.message, /24/);
  assert.equal((await d.post('/api/v1/time-entries').send(body(pid, { minutes: 40 }))).status, 201); // 1440 exacto
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(pid, { minutes: 1, workDate: '2026-05-11' })))
      .status,
    201,
  ); // otro día
  // otro miembro no comparte el límite
  assert.equal(
    (
      await (
        await loginAs(app, 'dev2')
      )
        .post('/api/v1/time-entries')
        .send(body(pid, { minutes: 600 }))
    ).status,
    201,
  );
});

test('asignación vigente en la fecha del trabajo y tarea del mismo proyecto', async () => {
  const { app, db, pid } = setup();
  const d = await loginAs(app, 'dev');
  // la asignación empieza el 1 de marzo y termina el 30 de junio
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(pid, { workDate: '2026-02-27' }))).status,
    422,
  );
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(pid, { workDate: '2026-03-02' }))).status,
    201,
  );
  const unassigned = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  const res = await d.post('/api/v1/time-entries').send(body(unassigned));
  assert.equal(res.status, 422);
  assert.match(res.body.error.message, /asignaci/i);
  assert.equal((await d.post('/api/v1/time-entries').send(body(9999))).status, 404);
  const mine = task(db, { project_id: pid });
  const foreign = task(db, { project_id: project(db) });
  const withTask = await d.post('/api/v1/time-entries').send(body(pid, { taskId: mine }));
  assert.equal(withTask.status, 201);
  assert.equal(withTask.body.data.taskId, mine);
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(pid, { taskId: foreign }))).status,
    422,
  );
  assert.equal(
    (await d.post('/api/v1/time-entries').send(body(pid, { taskId: 9999 }))).status,
    422,
  );
});

test('visibilidad: developer solo ve los suyos; admin y pm ven todos; detalle ajeno 404 para developer', async () => {
  const { app, db, pid, dev, dev2 } = setup();
  const mine = timeEntry(db, { project_id: pid, team_member_id: dev, work_date: '2026-05-11' });
  const theirs = timeEntry(db, { project_id: pid, team_member_id: dev2, work_date: '2026-05-11' });
  const d = await loginAs(app, 'dev');
  const list = await d.get('/api/v1/time-entries');
  assert.deepEqual(
    list.body.data.map((e) => e.id),
    [mine],
  );
  assert.deepEqual(
    (await d.get(`/api/v1/time-entries?memberId=${dev2}`)).body.data.map((e) => e.id),
    [mine],
  ); // se ignora
  assert.equal((await d.get(`/api/v1/time-entries/${mine}`)).status, 200);
  assert.equal((await d.get(`/api/v1/time-entries/${theirs}`)).status, 404);
  for (const who of ['pm', 'admin']) {
    const a = await loginAs(app, who);
    assert.equal((await a.get('/api/v1/time-entries')).body.meta.total, 2, who);
    assert.equal((await a.get(`/api/v1/time-entries/${theirs}`)).status, 200, who);
  }
  assert.equal((await d.get('/api/v1/time-entries/9999')).status, 404);
  assert.equal((await d.get('/api/v1/time-entries/abc')).status, 404);
});

test('listado: filtros por rango, proyecto, miembro (admin/pm), estado y paginación', async () => {
  const { app, db, pid, dev, dev2 } = setup();
  const other = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    work_date: '2026-05-04',
    status: 'approved',
  });
  timeEntry(db, { project_id: pid, team_member_id: dev2, work_date: '2026-05-05' });
  timeEntry(db, { project_id: other, team_member_id: dev, work_date: '2026-05-11' });
  const pm = await loginAs(app, 'pm');
  const get = async (qs) => (await pm.get(`/api/v1/time-entries${qs}`)).body;
  assert.equal((await get('')).meta.total, 3);
  assert.equal((await get('?from=2026-05-05&to=2026-05-11')).meta.total, 2);
  assert.equal((await get(`?projectId=${other}`)).meta.total, 1);
  assert.equal((await get(`?memberId=${dev2}`)).meta.total, 1);
  assert.equal((await get('?status=approved')).meta.total, 1);
  assert.equal((await get('?pageSize=2&page=2')).data.length, 1);
  assert.equal((await pm.get('/api/v1/time-entries?from=ayer')).status, 400);
  assert.equal((await pm.get('/api/v1/time-entries?status=raro')).status, 400);
});

test('editar (autor): parcial en draft con revalidación; ajeno 404; submitted/approved 422', async () => {
  const { app, db, pid, dev } = setup();
  const d = await loginAs(app, 'dev');
  const id = (await d.post('/api/v1/time-entries').send(body(pid))).body.data.id;
  const res = await d
    .patch(`/api/v1/time-entries/${id}`)
    .send({ minutes: 240, description: 'Ajustado' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.minutes, 240);
  assert.equal(res.body.data.description, 'Ajustado');
  assert.equal((await d.patch(`/api/v1/time-entries/${id}`).send({ minutes: 1441 })).status, 400);
  assert.equal(
    (await d.patch(`/api/v1/time-entries/${id}`).send({ workDate: '2026-05-20' })).status,
    422,
  );
  assert.equal((await d.patch(`/api/v1/time-entries/${id}`).send({})).status, 400);
  assert.equal(
    (await d.patch(`/api/v1/time-entries/${id}`).send({ status: 'approved' })).status,
    400,
  );
  assert.equal(
    (await d.patch(`/api/v1/time-entries/${id}`).send({ isBillable: false })).status,
    400,
  );
  // el límite diario descuenta la propia fila al editar
  assert.equal((await d.patch(`/api/v1/time-entries/${id}`).send({ minutes: 1440 })).status, 200);
  assert.equal(
    (await (await loginAs(app, 'dev2')).patch(`/api/v1/time-entries/${id}`).send({ minutes: 60 }))
      .status,
    404,
  );
  const submitted = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'submitted',
    work_date: '2026-05-04',
  });
  const approved = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'approved',
    work_date: '2026-05-05',
  });
  for (const eid of [submitted, approved]) {
    assert.equal((await d.patch(`/api/v1/time-entries/${eid}`).send({ minutes: 30 })).status, 422);
    assert.equal((await d.delete(`/api/v1/time-entries/${eid}`)).status, 422);
  }
});

test('editar un rechazado lo devuelve a draft y limpia el motivo', async () => {
  const { app, db, pid, dev } = setup();
  const id = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'rejected',
    rejection_reason: 'Falta detalle',
    work_date: '2026-05-04',
  });
  const res = await (
    await loginAs(app, 'dev')
  )
    .patch(`/api/v1/time-entries/${id}`)
    .send({ description: 'Con más detalle' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'draft');
  assert.equal(res.body.data.rejectionReason, null);
});

test('eliminar (autor): draft y rejected; 204/404; ajeno 404; bitácora', async () => {
  const { app, db, pid, dev } = setup();
  const d = await loginAs(app, 'dev');
  const id = (await d.post('/api/v1/time-entries').send(body(pid))).body.data.id;
  const rejected = timeEntry(db, {
    project_id: pid,
    team_member_id: dev,
    status: 'rejected',
    rejection_reason: 'x',
    work_date: '2026-05-04',
  });
  assert.equal(
    (await (await loginAs(app, 'dev2')).delete(`/api/v1/time-entries/${id}`)).status,
    404,
  );
  assert.equal((await d.delete(`/api/v1/time-entries/${id}`)).status, 204);
  assert.equal((await d.delete(`/api/v1/time-entries/${id}`)).status, 404);
  assert.equal((await d.delete(`/api/v1/time-entries/${rejected}`)).status, 204);
  assert.equal(
    db
      .prepare("SELECT count(*) FROM audit_log WHERE entity = 'time_entry' AND action = 'delete'")
      .pluck()
      .get(),
    2,
  );
});
