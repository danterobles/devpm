import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import * as f from '../helpers/factories.js';

test('v_project_progress: puntos totales, hechos y horas consumidas', () => {
  const db = createTestDb();
  const p = f.project(db, { budget_minutes: 6000 });
  f.task(db, { project_id: p, story_points: 5, status: 'done' });
  f.task(db, { project_id: p, story_points: 3, status: 'in_progress' });
  const parent = f.task(db, { project_id: p, story_points: 8, status: 'todo' });
  f.task(db, { project_id: p, story_points: 13, parent_task_id: parent }); // subtarea: no cuenta
  const m = f.teamMember(db);
  f.timeEntry(db, { project_id: p, team_member_id: m, minutes: 120, status: 'approved' });
  f.timeEntry(db, {
    project_id: p,
    team_member_id: m,
    minutes: 60,
    status: 'submitted',
    work_date: '2026-01-11',
  });
  f.timeEntry(db, {
    project_id: p,
    team_member_id: m,
    minutes: 600,
    status: 'draft',
    work_date: '2026-01-12',
  });

  const row = db.prepare('SELECT * FROM v_project_progress WHERE project_id = ?').get(p);
  assert.equal(row.total_points, 16);
  assert.equal(row.done_points, 5);
  assert.equal(row.spent_minutes, 180);
});

test('v_project_progress: proyecto sin tareas devuelve ceros', () => {
  const db = createTestDb();
  const p = f.project(db);
  const row = db.prepare('SELECT * FROM v_project_progress WHERE project_id = ?').get(p);
  assert.equal(row.total_points, 0);
  assert.equal(row.spent_minutes, 0);
});

test('v_member_allocations: solo proyectos en planning o active', () => {
  const db = createTestDb();
  const m = f.teamMember(db);
  const vivo = f.project(db, { status: 'active' });
  const muerto = f.project(db, { status: 'cancelled' });
  f.assignment(db, { project_id: vivo, team_member_id: m });
  f.assignment(db, { project_id: muerto, team_member_id: m });
  const rows = db.prepare('SELECT * FROM v_member_allocations WHERE team_member_id = ?').all(m);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project_id, vivo);
});

test('v_time_by_client_type: incluye tipo de cliente y tarifa', () => {
  const db = createTestDb();
  const ext = f.externalClient(db, { hourly_rate_cents: 90000 });
  const p = f.project(db, { client_id: ext, is_billable: 1 });
  f.timeEntry(db, { project_id: p, is_billable: 1 });
  const row = db.prepare('SELECT * FROM v_time_by_client_type').get();
  assert.equal(row.client_type, 'external');
  assert.equal(row.hourly_rate_cents, 90000);
});
