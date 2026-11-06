import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { createSnapshotsService } from '../../src/modules/burndown/snapshots.service.js';
import { createBurndownJob, msUntilNext } from '../../src/jobs/burndownSnapshot.js';
import { project, sprint, task } from '../helpers/factories.js';

afterEach(() => setClock(() => new Date()));
const clock = (iso) => setClock(() => new Date(iso));
const MIN = 60_000;
const HOUR = 60 * MIN;

test('msUntilNext: calcula la espera hasta las 23:55 locales de la zona de la aplicación', () => {
  const mx = 'America/Mexico_City'; // UTC-6 todo el año
  // 12:00 locales → faltan 11 h 55 min
  assert.equal(msUntilNext(new Date('2026-05-13T18:00:00Z'), mx), 11 * HOUR + 55 * MIN);
  // 23:56 locales (ya pasó el corte) → mañana a las 23:55: 23 h 59 min
  assert.equal(msUntilNext(new Date('2026-05-14T05:56:00Z'), mx), 23 * HOUR + 59 * MIN);
  // justo a las 23:55 → programa el siguiente día completo
  assert.equal(msUntilNext(new Date('2026-05-14T05:55:00Z'), mx), 24 * HOUR);
  assert.equal(msUntilNext(new Date('2026-05-13T23:00:00Z'), 'UTC'), 55 * MIN);
  assert.equal(msUntilNext(new Date('2026-05-13T23:55:30Z'), 'UTC'), 24 * HOUR - 30_000);
});

test('msUntilNext: acepta otra hora de corte', () => {
  assert.equal(
    msUntilNext(new Date('2026-05-13T10:00:00Z'), 'UTC', { hour: 12, minute: 30 }),
    2 * HOUR + 30 * MIN,
  );
});

function setup() {
  const db = createTestDb();
  const pid = project(db, { start_date: '2026-01-05', end_date: '2026-12-18' });
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
    committed_points: 8,
  });
  task(db, { project_id: pid, sprint_id: sid, story_points: 5, status: 'done' });
  task(db, {
    project_id: pid,
    sprint_id: sid,
    story_points: 3,
    status: 'todo',
    estimated_minutes: 180,
  });
  const snapshots = createSnapshotsService({ db, timezone: 'America/Mexico_City' });
  const rows = () =>
    db
      .prepare(
        'SELECT snapshot_date, total_points, completed_points, remaining_points, remaining_minutes FROM sprint_daily_snapshots WHERE sprint_id = ? ORDER BY snapshot_date',
      )
      .all(sid);
  return { db, pid, sid, snapshots, rows };
}

test('backfill: rellena los días faltantes arrastrando la última instantánea y captura hoy', () => {
  clock('2026-05-14T18:00:00Z'); // jueves; el servidor estuvo apagado lunes a miércoles
  const { db, sid, snapshots, rows } = setup();
  db.prepare(
    "INSERT INTO sprint_daily_snapshots (sprint_id, snapshot_date, total_points, completed_points, remaining_points, remaining_minutes) VALUES (?, '2026-05-11', 8, 2, 6, 240)",
  ).run(sid);
  const filled = snapshots.backfillActive();
  assert.equal(filled, 3); // 12, 13 (arrastrados) y hoy 14 (recalculado)
  assert.deepEqual(
    rows().map((r) => r.snapshot_date),
    ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14'],
  );
  const [d0, d1, d2, d3] = rows();
  assert.deepEqual(
    [d1.total_points, d1.completed_points, d1.remaining_minutes],
    [d0.total_points, d0.completed_points, d0.remaining_minutes],
  );
  assert.deepEqual([d2.total_points, d2.completed_points], [8, 2]);
  assert.deepEqual(
    [d3.total_points, d3.completed_points, d3.remaining_points, d3.remaining_minutes],
    [8, 5, 3, 180],
  ); // estado real de hoy
});

test('backfill es idempotente: ejecutarlo de nuevo no cambia ni duplica filas', () => {
  clock('2026-05-14T18:00:00Z');
  const { snapshots, rows } = setup();
  snapshots.backfillActive();
  const first = JSON.stringify(rows());
  snapshots.backfillActive();
  assert.equal(JSON.stringify(rows()), first);
});

test('backfill sin instantáneas previas captura solo hoy; no toca sprints planeados ni cerrados', () => {
  clock('2026-05-14T18:00:00Z');
  const { db, pid, snapshots, rows } = setup();
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
  snapshots.backfillActive();
  assert.deepEqual(
    rows().map((r) => r.snapshot_date),
    ['2026-05-14'],
  );
  for (const id of [planned, closed]) {
    assert.equal(
      db.prepare('SELECT count(*) FROM sprint_daily_snapshots WHERE sprint_id = ?').pluck().get(id),
      0,
    );
  }
});

test('el job: arranque rellena, programa el corte con setTimeout y se reprograma tras ejecutarse', () => {
  clock('2026-05-13T18:00:00Z');
  const { db, snapshots, rows } = setup();
  const scheduled = [];
  const cleared = [];
  const timers = {
    setTimeout: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout: (id) => cleared.push(id),
  };
  const logs = [];
  const job = createBurndownJob({
    snapshots,
    timezone: 'America/Mexico_City',
    timers,
    logger: { info: (m) => logs.push(m), error: (e) => logs.push(e) },
  });
  job.start();
  assert.deepEqual(
    rows().map((r) => r.snapshot_date),
    ['2026-05-13'],
  ); // relleno/captura al arrancar
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 11 * HOUR + 55 * MIN);

  // llega el corte de las 23:55: captura y reprograma
  clock('2026-05-14T05:55:30Z');
  db.prepare("UPDATE tasks SET status = 'done' WHERE status = 'todo'").run();
  scheduled[0].fn();
  assert.equal(rows().at(-1).snapshot_date, '2026-05-13'); // aún es el 13 en México
  assert.equal(rows().at(-1).completed_points, 8);
  assert.equal(scheduled.length, 2);
  assert.ok(scheduled[1].ms > 23 * HOUR);

  job.stop();
  assert.deepEqual(cleared, [2]);
  assert.ok(logs.length > 0);
});

test('el job registra el error y sigue programado si una ejecución falla', () => {
  clock('2026-05-13T18:00:00Z');
  const errors = [];
  const scheduled = [];
  const failing = {
    backfillActive: () => {},
    captureActive: () => {
      throw new Error('boom');
    },
  };
  const job = createBurndownJob({
    snapshots: failing,
    timezone: 'UTC',
    timers: { setTimeout: (fn, ms) => scheduled.push({ fn, ms }), clearTimeout() {} },
    logger: { info() {}, error: (e) => errors.push(e) },
  });
  job.start();
  scheduled[0].fn();
  assert.equal(errors.length, 1);
  assert.equal(scheduled.length, 2); // se reprogramó pese al fallo
});
