import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember, project } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const pid = project(db, { start_date: '2026-03-02', end_date: '2026-08-28' });
  return {
    db,
    pid,
    tm: teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' }),
    app: buildTestApp({ db }),
  };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const url = (pid) => `/api/v1/projects/${pid}/assignments`;
const asg = (tm, o = {}) => ({
  teamMemberId: tm,
  projectRole: 'Backend',
  allocationPercent: 60,
  startDate: '2026-04-01',
  endDate: '2026-06-30',
  ...o,
});

test('asignaciones: 401 sin sesión; leen todos; escriben solo admin y pm', async () => {
  const { app, pid, tm } = setup();
  assert.equal((await request(app).get(url(pid))).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal((await (await loginAs(app, role)).get(url(pid))).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post(url(pid)).send(asg(tm))).status, 403, role);
    assert.equal((await a.patch(`${url(pid)}/1`).send({ projectRole: 'x' })).status, 403, role);
    assert.equal((await a.delete(`${url(pid)}/1`)).status, 403, role);
  }
});

test('crear asignación: 201 con nombre del miembro, sin advertencias y con bitácora', async () => {
  const { app, db, pid, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(url(pid)).send(asg(tm));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.memberName, 'Ana Ruiz');
  assert.equal(res.body.data.allocationPercent, 60);
  assert.deepEqual(res.body.warnings, []);
  const list = await pm.get(url(pid));
  assert.equal(list.body.data.length, 1);
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'assignment'").pluck().get(),
    1,
  );
});

test('validación de asignaciones', async () => {
  const { app, pid, tm } = setup();
  const pm = await loginAs(app, 'pm');
  for (const b of [
    asg(tm, { projectRole: ' ' }),
    asg(tm, { allocationPercent: 0 }),
    asg(tm, { allocationPercent: 101 }),
    asg(tm, { allocationPercent: 50.5 }),
    asg(tm, { startDate: '2026-02-30' }),
    asg(tm, { startDate: '2026-06-30', endDate: '2026-04-01' }),
    asg(tm, { teamMemberId: undefined }),
    asg(tm, { extra: 1 }),
  ]) {
    assert.equal((await pm.post(url(pid)).send(b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await pm.post(url(9999)).send(asg(tm))).status, 404);
});

test('reglas: miembro existente y activo; periodo dentro del proyecto (422)', async () => {
  const { app, db, pid, tm } = setup();
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.post(url(pid)).send(asg(9999))).status, 422);
  const off = teamMember(db, { is_active: 0 });
  assert.equal((await pm.post(url(pid)).send(asg(off))).status, 422);
  const before = await pm.post(url(pid)).send(asg(tm, { startDate: '2026-03-01' }));
  assert.equal(before.status, 422);
  assert.equal(before.body.error.code, 'BUSINESS_RULE');
  assert.equal((await pm.post(url(pid)).send(asg(tm, { endDate: '2026-08-29' }))).status, 422);
  assert.equal(
    (await pm.post(url(pid)).send(asg(tm, { startDate: '2026-03-02', endDate: '2026-08-28' })))
      .status,
    201,
  );
});

test('RF-41: sobreasignación se guarda con advertencia OVER_ALLOCATION (60 % + 60 %)', async () => {
  const { app, db, pid, tm } = setup();
  const other = project(db, { start_date: '2026-03-02', end_date: '2026-08-28' });
  const pm = await loginAs(app, 'pm');
  await pm
    .post(url(other))
    .send(asg(tm, { allocationPercent: 60, startDate: '2026-05-01', endDate: '2026-07-31' }));
  const res = await pm.post(url(pid)).send(asg(tm, { allocationPercent: 60 }));
  assert.equal(res.status, 201);
  assert.equal(res.body.warnings.length, 1);
  const w = res.body.warnings[0];
  assert.equal(w.code, 'OVER_ALLOCATION');
  assert.equal(w.totalPercent, 120);
  assert.equal(w.teamMemberId, tm);
  assert.equal(db.prepare('SELECT count(*) FROM assignments').pluck().get(), 2);
});

test('sin traslape de periodos o con suma exactamente 100 % no hay advertencia', async () => {
  const { app, db, pid, tm } = setup();
  const other = project(db, { start_date: '2026-03-02', end_date: '2026-08-28' });
  const pm = await loginAs(app, 'pm');
  await pm
    .post(url(other))
    .send(asg(tm, { allocationPercent: 60, startDate: '2026-07-01', endDate: '2026-08-28' }));
  const apart = await pm
    .post(url(pid))
    .send(asg(tm, { allocationPercent: 60, startDate: '2026-04-01', endDate: '2026-06-30' }));
  assert.deepEqual(apart.body.warnings, []); // periodos disjuntos
  const exact = await pm
    .post(url(pid))
    .send(asg(tm, { allocationPercent: 40, startDate: '2026-04-01', endDate: '2026-06-30' }));
  assert.deepEqual(exact.body.warnings, []); // 60 + 40 = 100
  const touching = await pm
    .post(url(pid))
    .send(asg(tm, { allocationPercent: 10, startDate: '2026-06-30', endDate: '2026-07-01' }));
  assert.equal(touching.body.warnings[0].totalPercent > 100, true); // el día 30/06 y 01/07 se comparten (inclusivo)
});

test('editar: parcial con revalidación; la advertencia se recalcula excluyendo la propia fila', async () => {
  const { app, db, pid, tm } = setup();
  const other = project(db, { start_date: '2026-03-02', end_date: '2026-08-28' });
  const pm = await loginAs(app, 'pm');
  await pm.post(url(other)).send(asg(tm, { allocationPercent: 50 }));
  const id = (await pm.post(url(pid)).send(asg(tm, { allocationPercent: 40 }))).body.data.id;
  const ok = await pm.patch(`${url(pid)}/${id}`).send({ projectRole: 'Líder técnico' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.projectRole, 'Líder técnico');
  assert.deepEqual(ok.body.warnings, []); // 50 + 40 = 90
  const over = await pm.patch(`${url(pid)}/${id}`).send({ allocationPercent: 70 });
  assert.equal(over.body.warnings[0].totalPercent, 120);
  assert.equal((await pm.patch(`${url(pid)}/${id}`).send({ endDate: '2026-12-31' })).status, 422);
  assert.equal((await pm.patch(`${url(pid)}/${id}`).send({ startDate: '2026-07-01' })).status, 400);
  assert.equal((await pm.patch(`${url(pid)}/${id}`).send({})).status, 400);
  assert.equal((await pm.patch(`${url(pid)}/${id}`).send({ teamMemberId: 1 })).status, 400);
  assert.equal((await pm.patch(`${url(pid)}/9999`).send({ projectRole: 'x' })).status, 404);
});

test('eliminar asignación: 204/404 y solo dentro de su proyecto', async () => {
  const { app, db, pid, tm } = setup();
  const other = project(db, { start_date: '2026-03-02', end_date: '2026-08-28' });
  const pm = await loginAs(app, 'pm');
  const a = (await pm.post(url(pid)).send(asg(tm))).body.data.id;
  const b = (await pm.post(url(other)).send(asg(tm, { allocationPercent: 10 }))).body.data.id;
  assert.equal((await pm.delete(`${url(pid)}/${b}`)).status, 404);
  assert.equal((await pm.delete(`${url(pid)}/${a}`)).status, 204);
  assert.equal((await pm.delete(`${url(pid)}/${a}`)).status, 404);
  assert.equal(db.prepare('SELECT count(*) FROM assignments').pluck().get(), 1);
});

test('ficha del proyecto: equipo asignado, controles por rol y operaciones por formulario con advertencia', async () => {
  const { app, db, pid, tm } = setup();
  const other = project(db, { start_date: '2026-03-02', end_date: '2026-08-28' });
  const pm = await loginAs(app, 'pm');
  await pm.post(url(other)).send(asg(tm, { allocationPercent: 70 }));

  const add = await pm
    .post(`/projects/${pid}/assignments`)
    .type('form')
    .send({
      teamMemberId: String(tm),
      projectRole: 'Backend',
      allocationPercent: '60',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    });
  assert.equal(add.status, 302);
  assert.equal(add.headers.location, `/projects/${pid}?warning=over-allocation`);
  const page = await pm.get(`/projects/${pid}?warning=over-allocation`);
  assert.match(page.text, /Ana Ruiz/);
  assert.match(page.text, /sobreasign/i);
  assert.match(page.text, /name="allocationPercent"/);
  const viewer = await (await loginAs(app, 'viewer')).get(`/projects/${pid}`);
  assert.match(viewer.text, /Ana Ruiz/);
  assert.doesNotMatch(viewer.text, /name="allocationPercent"/);

  const bad = await pm
    .post(`/projects/${pid}/assignments`)
    .type('form')
    .send({
      teamMemberId: String(tm),
      projectRole: 'Backend',
      allocationPercent: '60',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /<form/);

  const id = db.prepare('SELECT id FROM assignments WHERE project_id = ?').pluck().get(pid);
  const del = await pm.post(`/projects/${pid}/assignments/${id}/delete`).type('form').send({});
  assert.equal(del.status, 302);
  assert.equal(
    db.prepare('SELECT count(*) FROM assignments WHERE project_id = ?').pluck().get(pid),
    0,
  );
  const v = await loginAs(app, 'viewer');
  assert.equal((await v.post(`/projects/${pid}/assignments`).type('form').send({})).status, 403);
});
