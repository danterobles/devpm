import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';
import { recordTaskStatus } from '../../lib/taskHistory.js';

export const toDto = (r) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  goal: r.goal,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  committedPoints: r.committed_points,
  completedPoints: r.completed_points,
  taskCount: r.task_count,
  totalPoints: r.total_points,
  donePoints: r.done_points,
});

/** Casos de uso de sprints (RF-60, RF-66). */
export function createSprintsService({ db, repository, snapshots = null, events = null }) {
  function requireProject(projectId) {
    const p = repository.findProject(projectId);
    if (!p) throw AppError.notFound('Proyecto no encontrado');
    return p;
  }
  function requireSprint(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Sprint no encontrado');
    return row;
  }
  function checkDates(project, sprintId, start, end) {
    if (end < start) {
      throw AppError.validation('Datos inválidos', [
        { field: 'endDate', message: 'La fecha final no puede ser anterior a la inicial' },
      ]);
    }
    if (start < project.start_date || end > project.end_date) {
      throw AppError.businessRule(
        `Las fechas deben quedar dentro del proyecto (${project.start_date} a ${project.end_date})`,
      );
    }
    if (repository.hasOverlap(project.id, start, end, sprintId ?? 0)) {
      throw AppError.businessRule('Las fechas se traslapan con otro sprint del proyecto');
    }
  }
  const audit = (actorId, id, action, changes) =>
    recordAudit(db, { userId: actorId, entity: 'sprint', entityId: id, action, changes });

  return {
    getProject: (id) => requireProject(id),
    list(projectId) {
      requireProject(projectId);
      return repository.listByProject(projectId).map(toDto);
    },
    get: (id) => toDto(requireSprint(id)),

    create(actorId, projectId, input) {
      const project = requireProject(projectId);
      checkDates(project, null, input.startDate, input.endDate);
      const id = db.transaction(() => {
        const newId = repository.insert(projectId, input);
        audit(actorId, newId, 'create', { name: [null, input.name] });
        return newId;
      })();
      events?.emit('sprint.updated', { projectId, sprintId: id });
      return toDto(repository.findById(id));
    },

    update(actorId, id, input) {
      const before = requireSprint(id);
      if (before.status === 'closed')
        throw AppError.businessRule('Un sprint cerrado es de solo lectura');
      const project = requireProject(before.project_id);
      const start = input.startDate ?? before.start_date;
      const end = input.endDate ?? before.end_date;
      if (input.startDate !== undefined || input.endDate !== undefined)
        checkDates(project, id, start, end);
      db.transaction(() => {
        repository.update(id, input);
        const changes = diff(before, repository.findById(id));
        for (const k of ['task_count', 'total_points', 'done_points']) delete changes[k];
        if (Object.keys(changes).length > 0) audit(actorId, id, 'update', changes);
      })();
      events?.emit('sprint.updated', { projectId: before.project_id, sprintId: id });
      return toDto(repository.findById(id));
    },

    /** RF-60: planned → active; fija committed_points. Solo un sprint activo por proyecto. */
    start(actorId, id) {
      const sprint = requireSprint(id);
      if (sprint.status !== 'planned') {
        throw AppError.businessRule('Solo se puede iniciar un sprint planeado');
      }
      if (repository.findActiveId(sprint.project_id) !== null) {
        throw AppError.businessRule('El proyecto ya tiene un sprint activo');
      }
      db.transaction(() => {
        const committedPoints = repository.sumPoints(id, false);
        repository.setStatus(id, 'active', { committedPoints });
        snapshots?.capture(id); // instantánea del día 0 del Burndown (RF-81)
        audit(actorId, id, 'status_change', {
          status: ['planned', 'active'],
          committed_points: [null, committedPoints],
        });
      })();
      events?.emit('sprint.started', { projectId: sprint.project_id, sprintId: id });
      return toDto(repository.findById(id));
    },

    /** RF-66: active → closed; fija completed_points y mueve las tareas no terminadas. */
    close(actorId, id, { moveTo = null } = {}) {
      const sprint = requireSprint(id);
      if (sprint.status !== 'active')
        throw AppError.businessRule('Solo se puede cerrar un sprint activo');
      if (moveTo !== null) {
        const target = repository.findById(moveTo);
        if (!target || target.project_id !== sprint.project_id || target.status !== 'planned') {
          throw AppError.businessRule(
            'El sprint destino debe ser un sprint planeado del mismo proyecto',
          );
        }
      }
      db.transaction(() => {
        const completedPoints = repository.sumPoints(id, true);
        snapshots?.capture(id); // instantánea final, antes de devolver tareas al backlog
        for (const t of repository.unfinishedTasks(id)) {
          if (moveTo !== null) {
            repository.moveTaskToSprint(t.id, moveTo);
          } else {
            repository.releaseTaskToBacklog(t.id);
            if (t.status !== 'backlog') {
              recordTaskStatus(db, {
                taskId: t.id,
                from: t.status,
                to: 'backlog',
                userId: actorId,
              });
            }
          }
        }
        repository.setStatus(id, 'closed', { completedPoints });
        audit(actorId, id, 'status_change', {
          status: ['active', 'closed'],
          completed_points: [null, completedPoints],
        });
      })();
      events?.emit('sprint.closed', { projectId: sprint.project_id, sprintId: id });
      return toDto(repository.findById(id));
    },

    remove(actorId, id) {
      const sprint = requireSprint(id);
      if (sprint.status !== 'planned') {
        throw AppError.businessRule('Solo se pueden eliminar sprints planeados');
      }
      if (repository.countTasks(id) > 0) {
        throw AppError.businessRule(
          'El sprint tiene tareas; muévelas al backlog antes de eliminarlo',
        );
      }
      db.transaction(() => {
        repository.remove(id);
        audit(actorId, id, 'delete', { name: [sprint.name, null] });
      })();
      events?.emit('sprint.updated', { projectId: sprint.project_id, sprintId: id });
    },
  };
}
