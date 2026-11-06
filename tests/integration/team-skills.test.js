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
const url = (tm) => `/api/v1/team-members/${tm}/skills`;

test('skills: sin sesión 401; leen todos; escriben solo admin y pm', async () => {
  const { app, tm } = setup();
  assert.equal((await request(app).get(url(tm))).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    assert.equal((await (await loginAs(app, role)).get(url(tm))).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post(url(tm)).send({ name: 'Node.js', level: 3 })).status, 403, role);
    assert.equal((await a.delete(`${url(tm)}/1`)).status, 403, role);
  }
});

test('asignar una habilidad nueva la crea en el catálogo (201) y queda en bitácora', async () => {
  const { app, db, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post(url(tm)).send({ name: '  Node.js ', category: 'framework', level: 4 });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Node.js');
  assert.equal(res.body.data.category, 'framework');
  assert.equal(res.body.data.level, 4);
  assert.equal(db.prepare('SELECT count(*) FROM skills').pluck().get(), 1);
  const list = await pm.get(url(tm));
  assert.deepEqual(
    list.body.data.map((s) => [s.name, s.level]),
    [['Node.js', 4]],
  );
  const audit = db
    .prepare("SELECT action FROM audit_log WHERE entity = 'team_member' AND entity_id = ?")
    .pluck()
    .get(tm);
  assert.equal(audit, 'update');
});

test('reasignar (sin distinguir mayúsculas) actualiza el nivel y reutiliza el catálogo (200)', async () => {
  const { app, db, tm } = setup();
  const pm = await loginAs(app, 'pm');
  await pm.post(url(tm)).send({ name: 'Node.js', level: 2 });
  const res = await pm.post(url(tm)).send({ name: 'node.JS', level: 5 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.level, 5);
  assert.equal(db.prepare('SELECT count(*) FROM skills').pluck().get(), 1);
  assert.equal(db.prepare('SELECT count(*) FROM team_member_skills').pluck().get(), 1);
  // otro miembro reutiliza la misma habilidad del catálogo
  const other = teamMember(db);
  await pm.post(url(other)).send({ name: 'NODE.js', level: 1 });
  assert.equal(db.prepare('SELECT count(*) FROM skills').pluck().get(), 1);
});

test('validación de habilidades', async () => {
  const { app, tm } = setup();
  const pm = await loginAs(app, 'pm');
  for (const body of [
    { name: '', level: 3 },
    { name: 'X', level: 0 },
    { name: 'X', level: 6 },
    { name: 'X', level: 2.5 },
    { name: 'X' },
    { name: 'X', level: 3, category: 'otra' },
    { name: 'X', level: 3, extra: true },
  ]) {
    assert.equal((await pm.post(url(tm)).send(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await pm.post(url(9999)).send({ name: 'X', level: 3 })).status, 404);
  assert.equal((await pm.get(url(9999))).status, 404);
});

test('quitar habilidad: 204, conserva el catálogo; 404 si no estaba asignada', async () => {
  const { app, db, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const created = await pm.post(url(tm)).send({ name: 'SQL', level: 3 });
  const skillId = created.body.data.skillId;
  assert.equal((await pm.delete(`${url(tm)}/${skillId}`)).status, 204);
  assert.equal(db.prepare('SELECT count(*) FROM team_member_skills').pluck().get(), 0);
  assert.equal(db.prepare('SELECT count(*) FROM skills').pluck().get(), 1);
  assert.equal((await pm.delete(`${url(tm)}/${skillId}`)).status, 404);
});

test('ficha del miembro: lista habilidades y controles solo para admin/pm', async () => {
  const { app, tm } = setup();
  const pm = await loginAs(app, 'pm');
  await pm.post(url(tm)).send({ name: 'React', category: 'framework', level: 4 });
  const asPm = await pm.get(`/team/${tm}`);
  assert.match(asPm.text, /React/);
  assert.match(asPm.text, /name="level"/);
  const viewer = await (await loginAs(app, 'viewer')).get(`/team/${tm}`);
  assert.match(viewer.text, /React/);
  assert.doesNotMatch(viewer.text, /name="level"/);
});

test('ficha: agregar y quitar habilidad por formulario', async () => {
  const { app, db, tm } = setup();
  const pm = await loginAs(app, 'pm');
  const add = await pm
    .post(`/team/${tm}/skills`)
    .type('form')
    .send({ name: 'Docker', category: 'tool', level: '3' });
  assert.equal(add.status, 302);
  assert.equal(add.headers.location, `/team/${tm}`);
  const skillId = db.prepare("SELECT id FROM skills WHERE name = 'Docker'").pluck().get();
  assert.equal(
    db.prepare('SELECT level FROM team_member_skills WHERE skill_id = ?').pluck().get(skillId),
    3,
  );
  const bad = await pm.post(`/team/${tm}/skills`).type('form').send({ name: 'Docker', level: '9' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);
  const del = await pm.post(`/team/${tm}/skills/${skillId}/delete`).type('form').send({});
  assert.equal(del.status, 302);
  assert.equal(db.prepare('SELECT count(*) FROM team_member_skills').pluck().get(), 0);
  const viewer = await loginAs(app, 'viewer');
  assert.equal(
    (await viewer.post(`/team/${tm}/skills`).type('form').send({ name: 'X', level: '1' })).status,
    403,
  );
});
