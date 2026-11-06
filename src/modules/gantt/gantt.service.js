import { AppError } from '../../lib/AppError.js';
import { today as todayIn } from '../../lib/dates.js';

const progressOf = (t) => {
  if (t.status === 'done') return 100;
  if (!t.estimated_minutes) return 0;
  return Math.min(95, Math.round((t.logged_minutes / t.estimated_minutes) * 100));
};
const byStart = (a, b) => a.start.localeCompare(b.start) || a.order - b.order;

/** Datos del Gantt (RF-70 a RF-72) en el formato de Frappe Gantt. */
export function createGanttService({ repository, timezone = 'America/Mexico_City' }) {
  return {
    /** RF-74: un renglón por proyecto activo; avance por puntos hechos (o por tareas hechas). */
    portfolio() {
      const projects = repository.activeProjects().map((p) => {
        let progress = 0;
        if (p.total_points > 0) progress = Math.round((p.done_points / p.total_points) * 100);
        else if (p.task_count > 0) progress = Math.round((p.done_count / p.task_count) * 100);
        return {
          id: `p${p.id}`,
          name: `${p.code} · ${p.name}`,
          start: p.start_date,
          end: p.end_date,
          progress,
          dependencies: [],
          custom_class: `portfolio-${p.priority}`,
          meta: {
            kind: 'project',
            projectId: p.id,
            code: p.code,
            clientName: p.client_name,
            managerName: p.manager_name,
            priority: p.priority,
          },
        };
      });
      return { today: todayIn(timezone), projects };
    },

    project(projectId, { groupBy = 'none', canReschedule = false } = {}) {
      const project = repository.findProject(projectId);
      if (!project) throw AppError.notFound('Proyecto no encontrado');
      const today = todayIn(timezone);

      const rows = repository.tasksOf(projectId);
      const scheduled = rows.filter((t) => t.start_date && t.due_date);
      const drawn = new Set(scheduled.map((t) => t.id));
      const deps = new Map();
      for (const d of repository.dependenciesOf(projectId)) {
        if (!drawn.has(d.task_id) || !drawn.has(d.depends_on_task_id)) continue;
        if (!deps.has(d.task_id)) deps.set(d.task_id, []);
        deps.get(d.task_id).push(`t${d.depends_on_task_id}`);
      }

      const taskItems = scheduled.map((t) => ({
        id: `t${t.id}`,
        name: t.title,
        start: t.start_date,
        end: t.due_date,
        progress: progressOf(t),
        dependencies: deps.get(t.id) ?? [],
        // Frappe Gantt agrega la clase con classList.add: debe ser un único token (sin espacios).
        custom_class:
          t.status !== 'done' && t.due_date < today ? 'gantt-late' : `gantt-${t.status}`,
        order: t.id,
        sprintStart: t.sprint_start,
        meta: {
          kind: 'task',
          taskId: t.id,
          status: t.status,
          parentTaskId: t.parent_task_id,
          sprintId: t.sprint_id,
          sprintName: t.sprint_name,
          assigneeName: t.assignee_name,
        },
      }));

      const milestoneItems = repository.milestonesOf(projectId).map((m) => ({
        id: `m${m.id}`,
        name: m.name,
        start: m.due_date,
        end: m.due_date,
        progress: m.status === 'completed' ? 100 : 0,
        dependencies: [],
        custom_class: `milestone-${m.status}`,
        order: m.id,
        meta: { kind: 'milestone', milestoneId: m.id, status: m.status },
      }));

      let items;
      if (groupBy === 'sprint') {
        const groupKey = (t) => (t.sprintStart ? `0|${t.sprintStart}|${t.meta.sprintId}` : '1|');
        taskItems.sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || byStart(a, b));
        items = [...taskItems, ...milestoneItems.sort(byStart)];
      } else {
        items = [...taskItems, ...milestoneItems].sort(byStart);
      }

      return {
        project: {
          id: project.id,
          code: project.code,
          name: project.name,
          startDate: project.start_date,
          endDate: project.end_date,
        },
        today,
        groupBy,
        canReschedule,
        tasks: items.map((item) => {
          const clean = { ...item };
          delete clean.order; // campos internos de ordenamiento
          delete clean.sprintStart;
          return clean;
        }),
        unscheduled: rows
          .filter((t) => !(t.start_date && t.due_date))
          .map((t) => ({ id: t.id, title: t.title, status: t.status, sprintName: t.sprint_name })),
      };
    },
  };
}
