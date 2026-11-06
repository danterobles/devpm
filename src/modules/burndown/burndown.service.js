import { AppError } from '../../lib/AppError.js';
import { addDays, today as todayIn } from '../../lib/dates.js';
import { idealLine } from './ideal.js';

/** Datos del Burndown de un sprint (RF-80, RF-82). */
export function createBurndownService({ db, timezone = 'America/Mexico_City' }) {
  const sprintRow = db.prepare(
    'SELECT id, project_id, name, status, start_date, end_date, committed_points FROM sprints WHERE id = ?',
  );
  const snapshots = db.prepare(
    `SELECT snapshot_date, total_points, remaining_points, remaining_minutes
       FROM sprint_daily_snapshots WHERE sprint_id = ? ORDER BY snapshot_date`,
  );
  const currentPoints = db.prepare(
    'SELECT COALESCE(SUM(story_points), 0) FROM tasks WHERE sprint_id = ?',
  );

  const projectCode = db.prepare('SELECT code FROM projects WHERE id = ?').pluck();

  return {
    projectCode: (projectId) => projectCode.get(projectId),
    sprint(sprintId) {
      const sprint = sprintRow.get(sprintId);
      if (!sprint) throw AppError.notFound('Sprint no encontrado');
      const today = todayIn(timezone);
      const rows = snapshots.all(sprintId);
      const byDate = new Map(rows.map((r) => [r.snapshot_date, r]));
      const first = rows[0]?.snapshot_date ?? null;
      const last = rows.at(-1)?.snapshot_date ?? null;
      // Un sprint activo sigue «vivo» hasta hoy; uno cerrado, hasta su instantánea final.
      const liveUntil =
        sprint.status === 'closed' ? last : sprint.status === 'active' ? today : null;

      // Eje: del inicio al fin planeado, ampliado si el sprint se pasó de su fecha final.
      const axisEnd = [sprint.end_date, liveUntil]
        .filter(Boolean)
        .reduce((a, b) => (a > b ? a : b));
      const days = [];
      for (let d = sprint.start_date; d <= axisEnd; d = addDays(d, 1)) days.push(d);

      // Real: valor del día o, en días pasados sin instantánea, el último conocido.
      let carried = null;
      const real = days.map((day) => {
        if (byDate.has(day)) carried = byDate.get(day);
        if (first === null || day < first || liveUntil === null || day > liveUntil) return null;
        return carried;
      });

      const commitment =
        sprint.committed_points ?? rows[0]?.total_points ?? currentPoints.pluck().get(sprintId);
      return {
        sprint: {
          id: sprint.id,
          projectId: sprint.project_id,
          name: sprint.name,
          status: sprint.status,
          startDate: sprint.start_date,
          endDate: sprint.end_date,
          committedPoints: sprint.committed_points,
        },
        metric: 'points',
        today,
        days,
        ideal: idealLine(days, commitment),
        remaining: real.map((r) => (r ? r.remaining_points : null)),
        total: real.map((r) => (r ? r.total_points : null)),
        scopeChanges: real.map((r, i) => {
          if (!r) return null;
          const previous = real[i - 1];
          return previous ? r.total_points - previous.total_points : 0;
        }),
      };
    },
  };
}
