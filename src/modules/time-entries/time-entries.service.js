import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';
import { today as todayIn } from '../../lib/dates.js';

export const toDto = (r) => ({
  id: r.id,
  teamMemberId: r.team_member_id,
  memberName: r.member_name,
  projectId: r.project_id,
  projectCode: r.project_code,
  projectName: r.project_name,
  taskId: r.task_id,
  taskTitle: r.task_title,
  workDate: r.work_date,
  minutes: r.minutes,
  description: r.description,
  isBillable: r.is_billable === 1,
  status: r.status,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  rejectionReason: r.rejection_reason,
});

const DERIVED = ['member_name', 'project_code', 'project_name', 'project_manager_id', 'task_title'];
const EDITABLE = ['draft', 'rejected'];

/** Casos de uso del registro de tiempo (RF-50, RF-53). */
export function createTimeEntriesService({ db, repository, timezone = 'America/Mexico_City' }) {
  const audit = (actorId, id, action, changes) =>
    recordAudit(db, { userId: actorId, entity: 'time_entry', entityId: id, action, changes });

  /** Miembro vinculado al usuario; sin vínculo no se puede registrar tiempo. */
  function ownMember(actor) {
    const memberId = repository.memberOfUser(actor.id);
    if (memberId === null) {
      throw AppError.forbidden('Tu usuario no está vinculado a un miembro del equipo');
    }
    return memberId;
  }
  /** Registro propio; para otro usuario se responde 404 (no se revela su existencia). */
  function requireOwn(actor, id) {
    const row = repository.findById(id);
    if (!row || row.team_member_id !== ownMember(actor)) {
      throw AppError.notFound('Registro de tiempo no encontrado');
    }
    return row;
  }
  function requireEditable(row) {
    if (!EDITABLE.includes(row.status)) {
      throw AppError.businessRule('Solo se pueden modificar registros en borrador o rechazados');
    }
  }

  /** Reglas de RF-53 y de asignación vigente sobre los valores finales del registro. */
  function validate({ memberId, projectId, taskId, workDate, minutes, exceptId = 0 }) {
    if (workDate > todayIn(timezone)) {
      throw AppError.businessRule('No se pueden registrar horas en fechas futuras');
    }
    if (!repository.hasAssignment(projectId, memberId, workDate)) {
      throw AppError.businessRule('No tienes una asignación vigente en el proyecto para esa fecha');
    }
    if (taskId !== null && taskId !== undefined) {
      const task = repository.findTask(taskId);
      if (!task || task.project_id !== projectId) {
        throw AppError.businessRule('La tarea debe pertenecer al proyecto');
      }
    }
    if (repository.minutesOnDay(memberId, workDate, exceptId) + minutes > 1440) {
      throw AppError.businessRule('El total del día no puede exceder 24 horas');
    }
  }
  function requireProject(projectId) {
    const project = repository.findProject(projectId);
    if (!project) throw AppError.notFound('Proyecto no encontrado');
    return project;
  }

  return {
    ownMember,
    requireOwn,
    requireEditable,
    audit,
    timezone,

    list(actor, query) {
      const filters = { ...query };
      if (actor.role === 'developer') filters.memberId = ownMember(actor);
      const { rows, total } = repository.list(filters, query);
      return { data: rows.map(toDto), meta: { page: query.page, pageSize: query.pageSize, total } };
    },

    get(actor, id) {
      const row = repository.findById(id);
      if (!row) throw AppError.notFound('Registro de tiempo no encontrado');
      if (actor.role === 'developer' && row.team_member_id !== ownMember(actor)) {
        throw AppError.notFound('Registro de tiempo no encontrado');
      }
      return toDto(row);
    },

    create(actor, input) {
      const memberId = ownMember(actor);
      const project = requireProject(input.projectId);
      validate({ ...input, memberId });
      const id = db.transaction(() => {
        const newId = repository.insert({
          ...input,
          teamMemberId: memberId,
          isBillable: project.is_billable === 1,
        });
        audit(actor.id, newId, 'create', {
          workDate: [null, input.workDate],
          minutes: [null, input.minutes],
        });
        return newId;
      })();
      return toDto(repository.findById(id));
    },

    update(actor, id, input) {
      const before = requireOwn(actor, id);
      requireEditable(before);
      const merged = {
        projectId: input.projectId ?? before.project_id,
        taskId: input.taskId === undefined ? before.task_id : input.taskId,
        workDate: input.workDate ?? before.work_date,
        minutes: input.minutes ?? before.minutes,
      };
      const project = requireProject(merged.projectId);
      validate({ ...merged, memberId: before.team_member_id, exceptId: id });
      db.transaction(() => {
        const fields = { ...input };
        if (input.projectId !== undefined && input.projectId !== before.project_id) {
          fields.isBillable = project.is_billable === 1; // hereda del nuevo proyecto
          if (input.taskId === undefined) fields.taskId = null;
        }
        if (before.status === 'rejected') fields.status = 'draft';
        repository.update(id, fields);
        if (before.status === 'rejected') repository.clearRejection(id);
        const changes = diff(before, repository.findById(id));
        for (const k of DERIVED) delete changes[k];
        if (Object.keys(changes).length > 0) audit(actor.id, id, 'update', changes);
      })();
      return toDto(repository.findById(id));
    },

    remove(actor, id) {
      const before = requireOwn(actor, id);
      requireEditable(before);
      db.transaction(() => {
        repository.remove(id);
        audit(actor.id, id, 'delete', {
          workDate: [before.work_date, null],
          minutes: [before.minutes, null],
        });
      })();
    },
  };
}
