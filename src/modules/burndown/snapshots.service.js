import { addDays, today as todayIn } from '../../lib/dates.js';

/**
 * Instantáneas diarias del sprint para el Burndown (RF-81, DATA §3.14).
 * Todas las escrituras son *upserts* por (sprint, día): se pueden repetir sin duplicar filas.
 */
export function createSnapshotsService({ db, timezone = 'America/Mexico_City' }) {
  const totals = db.prepare(
    `SELECT COALESCE(SUM(story_points), 0) AS total,
            COALESCE(SUM(CASE WHEN status = 'done' THEN story_points END), 0) AS completed,
            COALESCE(SUM(CASE WHEN status != 'done' THEN estimated_minutes END), 0) AS minutes
       FROM tasks WHERE sprint_id = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO sprint_daily_snapshots
       (sprint_id, snapshot_date, total_points, completed_points, remaining_points, remaining_minutes, captured_at)
     VALUES (@sprintId, @date, @total, @completed, @remaining, @minutes, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(sprint_id, snapshot_date) DO UPDATE SET
       total_points = excluded.total_points,
       completed_points = excluded.completed_points,
       remaining_points = excluded.remaining_points,
       remaining_minutes = excluded.remaining_minutes,
       captured_at = excluded.captured_at`,
  );
  const history = db.prepare(
    `SELECT snapshot_date, total_points, completed_points, remaining_points, remaining_minutes
       FROM sprint_daily_snapshots WHERE sprint_id = ? AND snapshot_date < ? ORDER BY snapshot_date`,
  );
  const insertMissing = db.prepare(
    `INSERT OR IGNORE INTO sprint_daily_snapshots
       (sprint_id, snapshot_date, total_points, completed_points, remaining_points, remaining_minutes)
     VALUES (@sprintId, @date, @total_points, @completed_points, @remaining_points, @remaining_minutes)`,
  );
  const MAX_FILL_DAYS = 400;
  const sprintStatus = db.prepare('SELECT status FROM sprints WHERE id = ?').pluck();
  const activeIds = db.prepare("SELECT id FROM sprints WHERE status = 'active'").pluck();

  const service = {
    /** Guarda (o actualiza) la instantánea de `date` (hoy por defecto) con el estado actual del sprint. */
    capture(sprintId, date = todayIn(timezone)) {
      const { total, completed, minutes } = totals.get(sprintId);
      upsert.run({
        sprintId,
        date,
        total,
        completed,
        remaining: total - completed,
        minutes,
      });
    },

    /** Instantánea de hoy para cada sprint activo; devuelve cuántos. */
    captureActive(date = todayIn(timezone)) {
      const ids = activeIds.all();
      db.transaction(() => ids.forEach((id) => service.capture(id, date)))();
      return ids.length;
    },

    /**
     * Al arrancar el servidor: rellena los días pasados sin instantánea de cada sprint activo
     * arrastrando el último valor conocido (exacto: todo cambio recalcula el día) y captura hoy.
     * Idempotente. Devuelve cuántas filas se agregaron o recalcularon.
     */
    backfillActive(today = todayIn(timezone)) {
      let written = 0;
      db.transaction(() => {
        for (const sprintId of activeIds.all()) {
          const past = history.all(sprintId, today);
          if (past.length > 0) {
            const byDate = new Map(past.map((r) => [r.snapshot_date, r]));
            let previous = past[0];
            let date = past[0].snapshot_date;
            for (let i = 0; date < today && i < MAX_FILL_DAYS; i += 1, date = addDays(date, 1)) {
              if (byDate.has(date)) {
                previous = byDate.get(date);
              } else {
                written += insertMissing.run({ sprintId, date, ...previous }).changes;
              }
            }
          }
          service.capture(sprintId, today);
          written += 1;
        }
      })();
      return written;
    },

    /** Recalcula la instantánea de hoy solo de los sprints activos de la lista; devuelve cuántos. */
    recalculate(sprintIds) {
      const ids = [...new Set(sprintIds.filter((id) => id !== null && id !== undefined))];
      let count = 0;
      for (const id of ids) {
        if (sprintStatus.get(id) === 'active') {
          service.capture(id);
          count += 1;
        }
      }
      return count;
    },
  };
  return service;
}
