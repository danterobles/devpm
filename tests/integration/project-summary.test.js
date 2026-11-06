import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember, project, assignment, timeEntry } from '../helpers/factories.js';

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

function seedProject(db) {
  const pid = project(db, { budget_minutes: 6000, status: 'active' });
  const tm = teamMember(db);
  assignment(db, { project_id: pid, team_member_id: tm });
  assignment(db, { project_id: pid, team_member_id: teamMember(db) });
  // Cuentan submitted + approved; no cuentan draft ni rejected.
  timeEntry(db, {
    project_id: pid,
    team_member_id: tm,
    minutes: 120,
    status: 'approved',
    is_billable: 1,
  });
  timeEntry(db, {
    project_id: pid,
    team_member_id: tm,
    minutes: 60,
    status: 'submitted',
    is_billable: 0,
  });
  timeEntry(db, {
    project_id: pid,
    team_member_id: tm,
    minutes: 480,
    status: 'draft',
    is_billable: 1,
  });
  timeEntry(db, {
    project_id: pid,
    team_member_id: tm,
    minutes: 240,
    status: 'rejected',
    rejection_reason: 'x',
    is_billable: 1,
  });
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'A', '2026-05-01', 'completed')",
  ).run(pid);
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'B', '2026-06-01', 'pending')",
  ).run(pid);
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'C', '2026-07-01', 'pending')",
  ).run(pid);
  return pid;
}

test('resumen: horas enviadas+aprobadas, facturables, presupuesto, miembros e hitos', async () => {
  const { app, db } = setup();
  const pid = seedProject(db);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const res = await (await loginAs(app, role)).get(`/api/v1/projects/${pid}/summary`);
    assert.equal(res.status, 200, role);
    assert.deepEqual(res.body.data, {
      consumedMinutes: 180,
      billableMinutes: 120,
      budgetMinutes: 6000,
      budgetUsedPercent: 3,
      assignedMembers: 2,
      milestonesTotal: 3,
      milestonesCompleted: 1,
    });
  }
});

test('resumen sin datos: ceros y porcentaje null si no hay presupuesto; 401 y 404', async () => {
  const { app, db } = setup();
  const pid = project(db, { budget_minutes: 0 });
  const pm = await loginAs(app, 'pm');
  const res = await pm.get(`/api/v1/projects/${pid}/summary`);
  assert.deepEqual(res.body.data, {
    consumedMinutes: 0,
    billableMinutes: 0,
    budgetMinutes: 0,
    budgetUsedPercent: null,
    assignedMembers: 0,
    milestonesTotal: 0,
    milestonesCompleted: 0,
  });
  assert.equal((await pm.get('/api/v1/projects/9999/summary')).status, 404);
  assert.equal((await request(app).get(`/api/v1/projects/${pid}/summary`)).status, 401);
});

test('la ficha muestra el resumen a todos los roles', async () => {
  const { app, db } = setup();
  const pid = seedProject(db);
  for (const role of ['pm', 'viewer']) {
    const page = await (await loginAs(app, role)).get(`/projects/${pid}`);
    assert.match(page.text, /Horas consumidas/);
    assert.match(page.text, /3\.0 h/); // 180 min
    assert.match(page.text, /100\.0 h/); // presupuesto 6000 min
    assert.match(page.text, /1 de 3/); // hitos completados
    assert.match(page.text, /Miembros asignados/);
  }
});
