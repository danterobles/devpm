import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { createTestDb } from '../helpers/testDb.js';
import { seed, SEED_PASSWORD } from '../../src/db/seeds/dev.js';
import { today } from '../../src/lib/dates.js';

let db;
let summary;
before(async () => {
  db = createTestDb();
  summary = await seed(db, { timezone: 'UTC' });
});

const one = (sql, ...p) =>
  db
    .prepare(sql)
    .pluck()
    .get(...p);

test('seed: cantidades esperadas y claves foráneas íntegras', () => {
  assert.equal(summary.users, 4);
  assert.equal(summary.teamMembers, 10);
  assert.equal(summary.projects, 6);
  assert.equal(db.pragma('foreign_key_check').length, 0);
  assert.equal(one("SELECT count(*) FROM clients WHERE type='internal'"), 3);
  assert.equal(one("SELECT count(*) FROM clients WHERE type='external'"), 3);
});

test('seed: un usuario por rol con contraseña conocida', async () => {
  const roles = db.prepare('SELECT role FROM users ORDER BY role').pluck().all();
  assert.deepEqual(roles, ['admin', 'developer', 'pm', 'viewer']);
  const hash = one("SELECT password_hash FROM users WHERE email = 'pm@devpm.local'");
  assert.ok(await bcrypt.compare(SEED_PASSWORD, hash));
});

test('seed: proyectos facturables solo para clientes externos', () => {
  const bad = one(
    `SELECT count(*) FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE p.is_billable <> (c.type = 'external')`,
  );
  assert.equal(bad, 0);
});

test('seed: hay un proyecto activo vencido y un hito vencido (riesgo)', () => {
  const t = today('UTC');
  assert.ok(one("SELECT count(*) FROM projects WHERE status='active' AND end_date < ?", t) >= 1);
  assert.ok(one("SELECT count(*) FROM milestones WHERE status='pending' AND due_date < ?", t) >= 1);
});

test('seed: exactamente un miembro sobreasignado (Diego al 120 %)', () => {
  const t = today('UTC');
  const rows = db
    .prepare(
      `SELECT team_member_id, SUM(allocation_percent) AS total FROM v_member_allocations
       WHERE start_date <= ? AND end_date >= ? GROUP BY team_member_id HAVING total > 100`,
    )
    .all(t, t);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 120);
});

test('seed: sprints activos con 15 tareas y snapshot de burndown por día', () => {
  const sprints = db.prepare("SELECT id FROM sprints WHERE status='active'").pluck().all();
  assert.equal(sprints.length, 3);
  for (const id of sprints) {
    assert.equal(one('SELECT count(*) FROM tasks WHERE sprint_id = ?', id), 15);
    assert.equal(one('SELECT count(*) FROM sprint_daily_snapshots WHERE sprint_id = ?', id), 10);
    const last = db
      .prepare(
        'SELECT * FROM sprint_daily_snapshots WHERE sprint_id = ? ORDER BY snapshot_date DESC',
      )
      .get(id);
    const done = one(
      "SELECT SUM(story_points) FROM tasks WHERE sprint_id = ? AND status='done'",
      id,
    );
    assert.equal(last.completed_points, done);
    assert.equal(last.remaining_points, last.total_points - done);
  }
});

test('seed: horas en varios estados, sin pasar de 24 h por miembro y día', () => {
  const statuses = db.prepare('SELECT DISTINCT status FROM time_entries').pluck().all().sort();
  assert.deepEqual(statuses, ['approved', 'draft', 'rejected', 'submitted']);
  assert.equal(
    one(`SELECT count(*) FROM (SELECT SUM(minutes) m FROM time_entries
         GROUP BY team_member_id, work_date HAVING m > 1440)`),
    0,
  );
});

test('seed: no hay horas en fines de semana, fechas futuras ni durante ausencias', () => {
  assert.equal(
    one("SELECT count(*) FROM time_entries WHERE strftime('%w', work_date) IN ('0','6')"),
    0,
  );
  assert.equal(one('SELECT count(*) FROM time_entries WHERE work_date > ?', today('UTC')), 0);
  assert.equal(
    one(`SELECT count(*) FROM time_entries te JOIN time_off o ON o.team_member_id = te.team_member_id
         AND te.work_date BETWEEN o.start_date AND o.end_date`),
    0,
  );
});

test('seed: dependencias sin ciclos (orden topológico posible)', () => {
  const cycles = one(
    `WITH RECURSIVE walk(origin, node, depth) AS (
       SELECT task_id, depends_on_task_id, 1 FROM task_dependencies
       UNION ALL
       SELECT w.origin, d.depends_on_task_id, w.depth + 1 FROM walk w
       JOIN task_dependencies d ON d.task_id = w.node WHERE w.depth < 50)
     SELECT count(*) FROM walk WHERE origin = node`,
  );
  assert.equal(cycles, 0);
});
