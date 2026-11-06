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
const member = (o = {}) => ({
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@team.local',
  position: 'backend',
  seniority: 'senior',
  weeklyCapacityMinutes: 2400,
  hourlyCostCents: 45000,
  hireDate: '2024-03-01',
  ...o,
});

test('API equipo: sin sesión 401; leen todos; escriben solo admin y pm', async () => {
  const { app, db } = setup();
  const id = teamMember(db);
  assert.equal((await request(app).get('/api/v1/team-members')).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.get('/api/v1/team-members')).status, 200, role);
    assert.equal((await a.get(`/api/v1/team-members/${id}`)).status, 200, role);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.post('/api/v1/team-members').send(member())).status, 403, role);
    assert.equal(
      (await a.patch(`/api/v1/team-members/${id}`).send({ seniority: 'lead' })).status,
      403,
      role,
    );
  }
});

test('crear miembro: 201, costo visible a pm, correo normalizado y bitácora', async () => {
  const { app, db } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post('/api/v1/team-members').send(member({ email: 'Ana@Team.local' }));
  assert.equal(res.status, 201);
  const m = res.body.data;
  assert.equal(m.email, 'ana@team.local');
  assert.equal(m.fullName, 'Ana Pérez');
  assert.equal(m.position, 'backend');
  assert.equal(m.hourlyCostCents, 45000);
  assert.equal(m.hireDate, '2024-03-01');
  assert.equal(m.isActive, true);
  assert.equal(
    db.prepare("SELECT action FROM audit_log WHERE entity = 'team_member'").pluck().get(),
    'create',
  );
});

test('valores por defecto: capacidad 2400 min y costo 0', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await pm.post('/api/v1/team-members').send({
    firstName: 'Luis',
    lastName: 'Gil',
    email: 'luis@team.local',
    position: 'qa',
    seniority: 'junior',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.weeklyCapacityMinutes, 2400);
  assert.equal(res.body.data.hourlyCostCents, 0);
  assert.equal(res.body.data.hireDate, null);
});

test('costo por hora oculto a developer y viewer', async () => {
  const { app, db } = setup();
  const id = teamMember(db, { hourly_cost_cents: 70000 });
  for (const role of ['admin', 'pm']) {
    const a = await loginAs(app, role);
    assert.equal((await a.get(`/api/v1/team-members/${id}`)).body.data.hourlyCostCents, 70000);
    assert.equal((await a.get('/api/v1/team-members')).body.data[0].hourlyCostCents, 70000);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal(
      'hourlyCostCents' in (await a.get(`/api/v1/team-members/${id}`)).body.data,
      false,
      role,
    );
    assert.equal(
      'hourlyCostCents' in (await a.get('/api/v1/team-members')).body.data[0],
      false,
      role,
    );
  }
});

test('validación de miembro', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const bad = [
    member({ firstName: ' ' }),
    member({ lastName: undefined }),
    member({ email: 'no-correo' }),
    member({ position: 'ceo' }),
    member({ seniority: 'dios' }),
    member({ weeklyCapacityMinutes: -1 }),
    member({ weeklyCapacityMinutes: 4801 }),
    member({ weeklyCapacityMinutes: 60.5 }),
    member({ hourlyCostCents: -5 }),
    member({ hireDate: '2024-13-45' }),
    member({ hireDate: '01/03/2024' }),
    member({ extra: 'campo desconocido' }),
  ];
  for (const body of bad) {
    const res = await pm.post('/api/v1/team-members').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('correo duplicado (sin distinguir mayúsculas) responde 409', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  await pm.post('/api/v1/team-members').send(member());
  const dup = await pm.post('/api/v1/team-members').send(member({ email: 'ANA@team.local' }));
  assert.equal(dup.status, 409);
});

test('listado: búsqueda, puesto, estado y paginación', async () => {
  const { app, db } = setup();
  teamMember(db, { first_name: 'Ana', last_name: 'Ruiz', position: 'backend' });
  teamMember(db, { first_name: 'Beto', last_name: 'Luna', position: 'qa', is_active: 0 });
  teamMember(db, { first_name: 'Carla', last_name: 'Soto', position: 'qa' });
  const a = await loginAs(app, 'viewer');
  assert.equal((await a.get('/api/v1/team-members')).body.meta.total, 3);
  assert.deepEqual(
    (await a.get('/api/v1/team-members?q=luna')).body.data.map((m) => m.firstName),
    ['Beto'],
  );
  assert.equal((await a.get('/api/v1/team-members?position=qa')).body.meta.total, 2);
  assert.equal((await a.get('/api/v1/team-members?status=active&position=qa')).body.meta.total, 1);
  const page = await a.get('/api/v1/team-members?pageSize=2&page=2');
  assert.equal(page.body.data.length, 1);
  assert.equal((await a.get('/api/v1/team-members?position=ceo')).status, 400);
});

test('detalle 404; editar parcial, desactivar y bitácora; sin DELETE', async () => {
  const { app, db } = setup();
  const id = teamMember(db);
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.get('/api/v1/team-members/9999')).status, 404);
  assert.equal((await pm.get('/api/v1/team-members/abc')).status, 404);
  const res = await pm
    .patch(`/api/v1/team-members/${id}`)
    .send({ seniority: 'lead', weeklyCapacityMinutes: 1200, isActive: false, hireDate: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.seniority, 'lead');
  assert.equal(res.body.data.weeklyCapacityMinutes, 1200);
  assert.equal(res.body.data.isActive, false);
  const audit = db
    .prepare("SELECT changes FROM audit_log WHERE entity = 'team_member' AND entity_id = ?")
    .pluck()
    .get(id);
  assert.ok(JSON.parse(audit).seniority);
  assert.equal((await pm.patch(`/api/v1/team-members/${id}`).send({})).status, 400);
  assert.equal(
    (await pm.patch('/api/v1/team-members/9999').send({ seniority: 'lead' })).status,
    404,
  );
  assert.equal((await pm.delete(`/api/v1/team-members/${id}`)).status, 404);
  assert.ok(db.prepare('SELECT 1 FROM team_members WHERE id = ?').get(id));
});

test('vistas de equipo: listado, ficha y controles según rol', async () => {
  const { app, db } = setup();
  const id = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz', hourly_cost_cents: 70000 });
  for (const [role, canWrite] of [
    ['admin', true],
    ['pm', true],
    ['developer', false],
    ['viewer', false],
  ]) {
    const a = await loginAs(app, role);
    const list = await a.get('/team');
    assert.equal(list.status, 200);
    assert.match(list.text, /Ana Ruiz/);
    assert.equal(list.text.includes('/team/new'), canWrite, `lista ${role}`);
    assert.equal(list.text.includes('700.00'), canWrite, `costo en lista ${role}`);
    const detail = await a.get(`/team/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.text.includes('>Guardar<'), canWrite, `ficha ${role}`);
    assert.equal(detail.text.includes('name="hourlyCost"'), canWrite, `costo en ficha ${role}`);
  }
  for (const role of ['developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.get('/team/new')).status, 403);
    assert.equal((await a.post('/team').type('form').send({})).status, 403);
    assert.equal((await a.post(`/team/${id}`).type('form').send({})).status, 403);
  }
  assert.equal((await request(app).get('/team')).status, 302);
});

test('crear y editar miembro por formulario: horas → minutos, costo en pesos → centavos', async () => {
  const { app, db } = setup();
  const pm = await loginAs(app, 'pm');
  const ok = await pm.post('/team').type('form').send({
    firstName: 'Eva',
    lastName: 'Mora',
    email: 'eva@team.local',
    position: 'fullstack',
    seniority: 'mid',
    weeklyHours: '37.5',
    hourlyCost: '525.75',
    hireDate: '',
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/team');
  const row = db.prepare("SELECT * FROM team_members WHERE email = 'eva@team.local'").get();
  assert.equal(row.weekly_capacity_minutes, 2250);
  assert.equal(row.hourly_cost_cents, 52575);
  assert.equal(row.hire_date, null);

  const bad = await pm.post('/team').type('form').send({
    firstName: 'X',
    lastName: 'Y',
    email: 'x@team.local',
    position: 'qa',
    seniority: 'mid',
    weeklyHours: '99',
    hourlyCost: '1',
  });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);
  const badNum = await pm.post('/team').type('form').send({
    firstName: 'X',
    lastName: 'Y',
    email: 'x@team.local',
    position: 'qa',
    seniority: 'mid',
    weeklyHours: 'abc',
    hourlyCost: '1',
  });
  assert.equal(badNum.status, 400);

  const edit = await pm.post(`/team/${row.id}`).type('form').send({
    firstName: 'Eva',
    lastName: 'Mora',
    email: 'eva@team.local',
    position: 'fullstack',
    seniority: 'senior',
    weeklyHours: '40',
    hourlyCost: '600',
    hireDate: '2023-05-02',
  });
  assert.equal(edit.status, 302);
  const after = db.prepare('SELECT * FROM team_members WHERE id = ?').get(row.id);
  assert.equal(after.seniority, 'senior');
  assert.equal(after.is_active, 0); // checkbox ausente = desactivado
  assert.equal(after.hire_date, '2023-05-02');
});
