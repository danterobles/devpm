import { addDays, nowIso, today as todayIn, weekday } from '../../lib/dates.js';

const hours = (minutes) => Math.round((minutes / 60) * 10) / 10;

/**
 * Avisos periódicos (PRD §5.12.1). `run(date)` es idempotente: cada aviso lleva una clave de
 * deduplicación, así que ejecutarlo varias veces el mismo día (p. ej. al reiniciar) no repite nada.
 * @param {{ repository: object, notifications: object, kpi: { getAll: Function }, timezone?: string }} deps
 */
export function createRemindersService({
  repository,
  notifications,
  kpi,
  timezone = 'America/Mexico_City',
}) {
  function hoursReminders(date, counts) {
    const day = weekday(date); // 0 = domingo
    if (day !== 3 && day !== 5) return; // miércoles y viernes
    const weekStart = addDays(date, -((day + 6) % 7));
    for (const m of repository.members()) {
      if (m.capacity <= 0) continue;
      const logged = repository.loggedMinutes(m.member_id, weekStart, date);
      if (day === 3 && logged < m.capacity * 0.5) {
        counts.hours += notifications.notify({
          userIds: [m.user_id],
          type: 'hours_midweek',
          title: 'Registra tus horas',
          body: `Llevas ${hours(logged)} h de ${hours(m.capacity)} h esta semana.`,
          link: '/time',
          dedupeKey: `midweek:${m.member_id}:${weekStart}`,
        });
      }
      if (day === 5) {
        const editable = repository.editableCount(m.member_id, weekStart, addDays(weekStart, 6));
        if (editable > 0) {
          counts.hours += notifications.notify({
            userIds: [m.user_id],
            type: 'hours_close',
            title: 'Envía tu semana',
            body: `Tienes ${editable} registro(s) sin enviar de esta semana.`,
            link: '/time',
            dedupeKey: `close:${m.member_id}:${weekStart}`,
          });
        } else if (logged < m.capacity * 0.8) {
          counts.hours += notifications.notify({
            userIds: [m.user_id],
            type: 'hours_close',
            title: 'Te faltan horas por registrar',
            body: `Llevas ${hours(logged)} h de ${hours(m.capacity)} h esta semana.`,
            link: '/time',
            dedupeKey: `close:${m.member_id}:${weekStart}`,
          });
        }
      }
    }
  }

  return {
    /** Resultado de la última ejecución (para la pantalla de estado). */
    lastRun: null,
    /** Genera los avisos del día y limpia las notificaciones leídas antiguas. */
    run(date = todayIn(timezone)) {
      const counts = { hours: 0, tasks: 0, milestones: 0, risk: 0, pruned: 0 };
      hoursReminders(date, counts);

      for (const t of repository.overdueTasks(date)) {
        counts.tasks += notifications.notify({
          userIds: [notifications.userOfMember(t.member_id)],
          type: 'task_overdue',
          title: 'Tarea vencida',
          body: `«${t.title}» (${t.project_code}) venció el ${t.due_date}.`,
          link: `/tasks/${t.id}`,
          dedupeKey: `overdue:${t.id}`,
        });
      }
      for (const ms of repository.overdueMilestones(date)) {
        counts.milestones += notifications.notify({
          userIds: notifications.leaderUserIds(ms.project_id),
          type: 'milestone_overdue',
          title: 'Hito vencido',
          body: `«${ms.name}» (${ms.project_code}) venció el ${ms.due_date}.`,
          link: `/projects/${ms.project_id}`,
          dedupeKey: `milestone:${ms.id}`,
        });
      }
      // A lo más una vez por semana y proyecto (la semana empieza el lunes).
      const weekStart = addDays(date, -((weekday(date) + 6) % 7));
      for (const project of kpi.getAll({}, { includeRevenue: false }).risk) {
        counts.risk += notifications.notify({
          userIds: notifications.leaderUserIds(project.id),
          type: 'project_at_risk',
          title: 'Proyecto en riesgo',
          body: `${project.code} · ${project.name}: ${project.causes.map((c) => c.message).join('; ')}.`,
          link: `/projects/${project.id}`,
          dedupeKey: `risk:${project.id}:${weekStart}`,
        });
      }
      counts.pruned = notifications.prune(date);
      this.lastRun = { at: nowIso(), counts };
      return counts;
    },
  };
}
