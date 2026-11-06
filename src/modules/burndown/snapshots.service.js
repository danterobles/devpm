import { today as todayIn } from '../../lib/dates.js';

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
