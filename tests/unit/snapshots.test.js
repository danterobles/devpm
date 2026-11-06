import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { createSnapshotsService } from '../../src/modules/burndown/snapshots.service.js';
import { project, sprint, task } from '../helpers/factories.js';

afterEach(() => setClock(() => new Date()));
const clock = (iso) => setClock(() => new Date(iso));

function setup(status = 'active') {
  const db = createTestDb();
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  const sid = sprint(db, {
    project_id: pid,
    status,
    start_date: '2026-05-11',
    end_date: '2026-05-22',
    committed_points: 13,
  });
  const service = createSnapshotsService({ db, timezone: 'America/Mexico_City' });
  const rows = () =>
    db
      .prepare('SELECT * FROM sprint_daily_snapshots WHERE sprint_id = ? ORDER BY snapshot_date')
      .all(sid);
  return { db, pid, sid, service, rows };
}

test('capture calcula puntos totales, completados, restantes y minutos restantes (padre y subtareas)', () => {
  clock('2026-05-13T18:00:00Z');
  const { db, pid, sid, service, rows } = setup();
  const parent = task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: 5,
    status: 'done',
    estimated_minutes: 300,
  });
  task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: 3,
    status: 'in_progress',
    estimated_minutes: 120,
    parent_task_id: parent,
  });
  task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: 8,
    status: 'todo',
    estimated_minutes: 480,
  });
  task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: null,
    status: 'todo',
    estimated_minutes: null,
  });
  task(db, { project_id: pid, story_points: 21, status: 'todo' }); // backlog: no cuenta
  service.capture(sid);
  const [row] = rows();
  assert.equal(row.snapshot_date, '2026-05-13');
  assert.equal(row.total_points, 16);
  assert.equal(row.completed_points, 5);
  assert.equal(row.remaining_points, 11);
  assert.equal(row.remaining_minutes, 600); // las no terminadas: 120 + 480
  assert.ok(row.captured_at);
});

test('upsert idempotente: capturar varias veces el mismo día deja una fila con los valores más recientes', () => {
  clock('2026-05-13T18:00:00Z');
  const { db, pid, sid, service, rows } = setup();
  const t = task(db, { project_id: pid, sprint_id: sid, story_points: 5, status: 'todo' });
  service.capture(sid);
  service.capture(sid);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].completed_points, 0);
  db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(t);
  service.capture(sid);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].completed_points, 5);
  assert.equal(rows()[0].remaining_points, 0);
});

test('un nuevo día agrega otra fila; la fecha usa la zona horaria de la aplicación', () => {
  const { db, pid, sid, service, rows } = setup();
  task(db, { project_id: pid, sprint_id: sid, story_points: 5 });
  clock('2026-05-13T02:00:00Z'); // en México todavía es el 12
  service.capture(sid);
  clock('2026-05-13T18:00:00Z');
  service.capture(sid);
  assert.deepEqual(
    rows().map((r) => r.snapshot_date),
    ['2026-05-12', '2026-05-13'],
  );
});

test('capture acepta una fecha explícita (para pruebas y relleno)', () => {
  const { db, pid, sid, service, rows } = setup();
  task(db, { project_id: pid, sprint_id: sid, story_points: 2 });
  service.capture(sid, '2026-05-11');
  assert.equal(rows()[0].snapshot_date, '2026-05-11');
});

test('captureActive solo toma los sprints activos', () => {
  clock('2026-05-13T18:00:00Z');
  const { db, pid, service, rows } = setup();
  const planned = sprint(db, {
    project_id: pid,
    status: 'planned',
    start_date: '2026-06-01',
    end_date: '2026-06-12',
  });
  const closed = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-04-06',
    end_date: '2026-04-17',
  });
  task(db, { project_id: pid, sprint_id: planned, story_points: 3 });
  assert.equal(service.captureActive(), 1);
  assert.equal(rows().length, 1);
  const count = (id) =>
    db.prepare('SELECT count(*) FROM sprint_daily_snapshots WHERE sprint_id = ?').pluck().get(id);
  assert.equal(count(planned), 0);
  assert.equal(count(closed), 0);
});

test('recalculate: solo si el sprint está activo; ignora planeados, cerrados e inexistentes', () => {
  clock('2026-05-13T18:00:00Z');
  const { db, pid, service } = setup();
  const planned = sprint(db, {
    project_id: pid,
    status: 'planned',
    start_date: '2026-06-01',
    end_date: '2026-06-12',
  });
  const closed = sprint(db, {
    project_id: pid,
    status: 'closed',
    start_date: '2026-04-06',
    end_date: '2026-04-17',
  });
  assert.equal(service.recalculate([planned, closed, 9999, null, undefined]), 0);
  assert.equal(db.prepare('SELECT count(*) FROM sprint_daily_snapshots').pluck().get(), 0);
});
