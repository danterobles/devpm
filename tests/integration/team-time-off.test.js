import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  return { db, tm: teamMember(db), app: buildTestApp({ db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const url = (tm) => `/api/v1/team-members/${tm}/time-off`;
const off = (o = {}) => ({
  type: 'vacation',
  startDate: '2026-07-06',
  endDate: '2026-07-10',
  ...o,
});

test('ausencias: sin sesión 401; leen todos; escriben solo admin y pm', async () => {
  const { app, tm } = setup();
  assert.equal((await request(app).get(url(tm))).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal((await (await loginAs(app, role)).get(url(tm))).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post(url(tm)).send(off())).status, 403, role);
    assert.equal((await a.patch(`${url(tm)}/1`).send({ notes: 'x' })).status, 403, role);
    assert.equal((await a.delete(`${url(tm)}/1`)).status, 403, role);
  }
});

test('crear ausencia: 201 con días naturales, sin advertencias y con bitácora', async () => {
  const { app, db, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(url(tm)).send(off({ notes: 'Verano' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.type, 'vacation');
  assert.equal(res.body.data.startDate, '2026-07-06');
  assert.equal(res.body.data.days, 5);
  assert.equal(res.body.data.notes, 'Verano');
  assert.deepEqual(res.body.warnings, []);
  const one = await pm
    .post(url(tm))
    .send(off({ type: 'sick', startDate: '2026-08-03', endDate: '2026-08-03' }));
  assert.equal(one.body.data.days, 1);
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'time_off'").pluck().get(),
    2,
  );
});

test('validación de ausencias', async () => {
  const { app, tm } = setup();
  const pm = await loginAs(app, 'pm');
  for (const body of [
    off({ type: 'otra' }),
    off({ startDate: '2026-02-30' }),
    off({ endDate: '10/07/2026' }),
    off({ startDate: '2026-07-10', endDate: '2026-07-06' }),
    off({ startDate: undefined }),
    off({ extra: 1 }),
  ]) {
    const res = await pm.post(url(tm)).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await pm.post(url(9999)).send(off())).status, 404);
});

test('traslape: se guarda y devuelve advertencia TIME_OFF_OVERLAP con los ids', async () => {
  const { app, tm, db } = setup();
  const pm = await loginAs(app, 'pm');
  const first = await pm.post(url(tm)).send(off());
  const touching = await pm
    .post(url(tm))
    .send(off({ startDate: '2026-07-11', endDate: '2026-07-12' }));
  assert.deepEqual(touching.body.warnings, []); // contiguas, no traslapadas
  const overlap = await pm
    .post(url(tm))
    .send(off({ type: 'personal', startDate: '2026-07-10', endDate: '2026-07-11' }));
  assert.equal(overlap.status, 201);
  assert.equal(overlap.body.warnings[0].code, 'TIME_OFF_OVERLAP');
  assert.deepEqual(
    overlap.body.warnings[0].overlapsWith.sort(),
    [first.body.data.id, touching.body.data.id].sort(),
  );
  // otro miembro no cuenta
  const other = teamMember(db);
  assert.deepEqual((await pm.post(url(other)).send(off())).body.warnings, []);
});

test('listar ordenado por fecha descendente; filtro por rango', async () => {
  const { app, tm } = setup();
  const pm = await loginAs(app, 'pm');
  await pm.post(url(tm)).send(off({ startDate: '2026-01-05', endDate: '2026-01-06' }));
  await pm.post(url(tm)).send(off({ startDate: '2026-09-01', endDate: '2026-09-02' }));
  const all = await pm.get(url(tm));
  assert.deepEqual(
    all.body.data.map((o) => o.startDate),
    ['2026-09-01', '2026-01-05'],
  );
  const ranged = await pm.get(`${url(tm)}?from=2026-08-01&to=2026-12-31`);
  assert.deepEqual(
    ranged.body.data.map((o) => o.startDate),
    ['2026-09-01'],
  );
  assert.equal((await pm.get(`${url(tm)}?from=ayer`)).status, 400);
});

test('editar: parcial, valida fechas contra las existentes y excluye la propia del traslape', async () => {
  const { app, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const created = await pm.post(url(tm)).send(off());
  const id = created.body.data.id;
  const res = await pm
    .patch(`${url(tm)}/${id}`)
    .send({ endDate: '2026-07-11', notes: 'Extendida' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.days, 6);
  assert.deepEqual(res.body.warnings, []);
  assert.equal((await pm.patch(`${url(tm)}/${id}`).send({ endDate: '2026-07-01' })).status, 400);
  assert.equal((await pm.patch(`${url(tm)}/${id}`).send({})).status, 400);
  assert.equal((await pm.patch(`${url(tm)}/9999`).send({ notes: 'x' })).status, 404);
  assert.equal(
    (await pm.patch(`/api/v1/team-members/9999/time-off/${id}`).send({ notes: 'x' })).status,
    404,
  );
});

test('eliminar ausencia: 204 y 404; no borra otras ni de otro miembro', async () => {
  const { app, db, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const other = teamMember(db);
  const a = (await pm.post(url(tm)).send(off())).body.data.id;
  const b = (await pm.post(url(other)).send(off())).body.data.id;
  assert.equal((await pm.delete(`${url(tm)}/${b}`)).status, 404); // pertenece a otro miembro
  assert.equal((await pm.delete(`${url(tm)}/${a}`)).status, 204);
  assert.equal(db.prepare('SELECT count(*) FROM time_off').pluck().get(), 1);
  assert.equal((await pm.delete(`${url(tm)}/${a}`)).status, 404);
});

test('ficha: lista ausencias, controles por rol, alta/baja por formulario y advertencia de traslape', async () => {
  const { app, db, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const add = await pm
    .post(`/team/${tm}/time-off`)
    .type('form')
    .send({ type: 'vacation', startDate: '2026-07-06', endDate: '2026-07-10', notes: '' });
  assert.equal(add.status, 302);
  assert.equal(add.headers.location, `/team/${tm}`);
  const overlap = await pm
    .post(`/team/${tm}/time-off`)
    .type('form')
    .send({ type: 'sick', startDate: '2026-07-08', endDate: '2026-07-09' });
  assert.equal(overlap.status, 302);
  assert.equal(overlap.headers.location, `/team/${tm}?warning=time-off-overlap`);
  const page = await pm.get(`/team/${tm}?warning=time-off-overlap`);
  assert.match(page.text, /2026-07-06/);
  assert.match(page.text, /traslapa/);
  assert.match(page.text, /name="startDate"/);

  const bad = await pm
    .post(`/team/${tm}/time-off`)
    .type('form')
    .send({ type: 'vacation', startDate: '2026-07-10', endDate: '2026-07-01' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);

  const viewer = await (await loginAs(app, 'viewer')).get(`/team/${tm}`);
  assert.match(viewer.text, /2026-07-06/);
  assert.doesNotMatch(viewer.text, /name="startDate"/);

  const id = db.prepare('SELECT id FROM time_off ORDER BY id').pluck().get();
  const del = await pm.post(`/team/${tm}/time-off/${id}/delete`).type('form').send({});
  assert.equal(del.status, 302);
  assert.equal(db.prepare('SELECT count(*) FROM time_off').pluck().get(), 1);
  const v = await loginAs(app, 'viewer');
  assert.equal((await v.post(`/team/${tm}/time-off`).type('form').send({})).status, 403);
});
