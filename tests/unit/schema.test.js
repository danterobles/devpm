import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import * as f from '../helpers/factories.js';

let db;
beforeEach(() => {
  db = createTestDb();
});

const rejects = (fn, pattern = /constraint/i) => assert.throws(fn, pattern);

test('clients: interno exige department; externo exige razón social y tarifa', () => {
  assert.ok(f.internalClient(db));
  assert.ok(f.externalClient(db));
  rejects(() => f.internalClient(db, { department: null }));
  rejects(() => f.externalClient(db, { legal_name: null }));
  rejects(() => f.externalClient(db, { hourly_rate_cents: null }));
  rejects(() => f.externalClient(db, { hourly_rate_cents: -1 }));
  rejects(() => f.internalClient(db, { type: 'otro' }));
});

test('clients: tax_id único cuando existe, pero admite varios nulos', () => {
  f.externalClient(db, { tax_id: 'AAA010101AAA' });
  rejects(() => f.externalClient(db, { tax_id: 'AAA010101AAA' }));
  f.internalClient(db);
  f.internalClient(db);
});

test('team_members: email único sin distinguir mayúsculas y enums válidos', () => {
  f.teamMember(db, { email: 'Ana@Test.local' });
  rejects(() => f.teamMember(db, { email: 'ana@test.local' }));
  rejects(() => f.teamMember(db, { position: 'chef' }));
  rejects(() => f.teamMember(db, { weekly_capacity_minutes: 9999 }));
});

test('fechas: formato inválido o fin anterior al inicio se rechazan', () => {
  rejects(() => f.project(db, { start_date: '01/02/2026' }));
  rejects(() => f.project(db, { start_date: '2026-05-01', end_date: '2026-04-01' }));
  const member = f.teamMember(db);
  rejects(() =>
    f.assignment(db, { team_member_id: member, start_date: '2026-03-01', end_date: '2026-02-01' }),
  );
});

test('projects: código único y cliente con proyectos no se puede eliminar (RESTRICT)', () => {
  const client = f.internalClient(db);
  f.project(db, { code: 'PRJ-X', client_id: client });
  rejects(() => f.project(db, { code: 'PRJ-X', client_id: client }));
  rejects(() => db.prepare('DELETE FROM clients WHERE id = ?').run(client), /FOREIGN KEY/i);
});

test('projects: FK inválida y estados fuera de catálogo se rechazan', () => {
  rejects(() => f.project(db, { client_id: 9999 }), /FOREIGN KEY/i);
  rejects(() => f.project(db, { status: 'dormido' }));
  rejects(() => f.project(db, { is_billable: 2 }));
});

test('sprints: solo un sprint activo por proyecto', () => {
  const p = f.project(db);
  f.sprint(db, { project_id: p, status: 'active' });
  rejects(() => f.sprint(db, { project_id: p, status: 'active' }));
  f.sprint(db, { project_id: p, status: 'planned' });
  f.sprint(db, { project_id: p, status: 'closed' });
  f.sprint(db, { project_id: f.project(db), status: 'active' });
});

test('tasks: story points Fibonacci, fechas coherentes y backlog por defecto', () => {
  const p = f.project(db);
  const id = f.task(db, { project_id: p, story_points: 5 });
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').pluck().get(id), 'backlog');
  rejects(() => f.task(db, { project_id: p, story_points: 4 }));
  rejects(() => f.task(db, { project_id: p, start_date: '2026-02-10', due_date: '2026-02-01' }));
});

test('task_dependencies: sin auto-dependencia ni duplicados', () => {
  const p = f.project(db);
  const a = f.task(db, { project_id: p });
  const b = f.task(db, { project_id: p });
  const ins = (x, y) =>
    db
      .prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)')
      .run(x, y);
  ins(b, a);
  rejects(() => ins(b, a));
  rejects(() => ins(a, a));
});

test('time_entries: minutos 1..1440, rechazo exige motivo, estados válidos', () => {
  assert.ok(f.timeEntry(db, { minutes: 1440 }));
  rejects(() => f.timeEntry(db, { minutes: 0 }));
  rejects(() => f.timeEntry(db, { minutes: 1441 }));
  rejects(() => f.timeEntry(db, { status: 'rejected' }));
  assert.ok(f.timeEntry(db, { status: 'rejected', rejection_reason: 'Faltan detalles' }));
  rejects(() => f.timeEntry(db, { status: 'pagado' }));
});

test('assignments: dedicación 1..100', () => {
  assert.ok(f.assignment(db, { allocation_percent: 100 }));
  rejects(() => f.assignment(db, { allocation_percent: 0 }));
  rejects(() => f.assignment(db, { allocation_percent: 101 }));
});

test('borrados en cascada: proyecto elimina hitos, sprints, tareas y asignaciones', () => {
  const p = f.project(db);
  const s = f.sprint(db, { project_id: p });
  const t = f.task(db, { project_id: p, sprint_id: s });
  f.assignment(db, { project_id: p });
  db.prepare('INSERT INTO milestones (project_id, name, due_date) VALUES (?, ?, ?)').run(
    p,
    'M1',
    '2026-03-01',
  );
  db.prepare('DELETE FROM projects WHERE id = ?').run(p);
  for (const table of ['sprints', 'tasks', 'assignments', 'milestones']) {
    assert.equal(db.prepare(`SELECT count(*) FROM ${table}`).pluck().get(), 0, table);
  }
  assert.equal(db.prepare('SELECT count(*) FROM tasks WHERE id = ?').pluck().get(t), 0);
});

test('borrar sprint deja sus tareas en backlog (SET NULL)', () => {
  const p = f.project(db);
  const s = f.sprint(db, { project_id: p });
  const t = f.task(db, { project_id: p, sprint_id: s });
  db.prepare('DELETE FROM sprints WHERE id = ?').run(s);
  assert.equal(db.prepare('SELECT sprint_id FROM tasks WHERE id = ?').pluck().get(t), null);
});

test('users: rol válido y un miembro solo puede vincularse a un usuario', () => {
  const m = f.teamMember(db);
  f.user(db, { team_member_id: m });
  rejects(() => f.user(db, { team_member_id: m }));
  rejects(() => f.user(db, { role: 'superuser' }));
});

test('audit_log y settings exigen JSON válido', () => {
  rejects(() =>
    db
      .prepare(
        "INSERT INTO audit_log (entity, entity_id, action, changes) VALUES ('x', 1, 'create', 'no-json')",
      )
      .run(),
  );
  rejects(() => db.prepare("INSERT INTO settings (key, value) VALUES ('k', 'no-json')").run());
  db.prepare("INSERT INTO settings (key, value) VALUES ('k', '{\"a\":1}')").run();
});
