import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';
import { addDays, nowIso, today as todayIn, weekday } from '../../lib/dates.js';

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

export const mondayOf = (date) => addDays(date, -((weekday(date) + 6) % 7));
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
    isOwn: (actor, entry) => entry.teamMemberId === repository.memberOfUser(actor.id),
    requireOwn,
    requireEditable,
    audit,
    timezone,

    /** RF-51: hoja semanal (día × proyecto) de un miembro. */
    sheet(actor, { week, memberId } = {}) {
      const own = repository.memberOfUser(actor.id);
      let target = own;
      if (['admin', 'pm'].includes(actor.role) && memberId !== undefined) target = memberId;
      if (target === null) ownMember(actor); // lanza 403: sin miembro vinculado
      const member = repository.findMember(target);
      if (!member) throw AppError.notFound('Miembro no encontrado');
      const weekStart = mondayOf(week ?? todayIn(timezone));
      const weekEnd = addDays(weekStart, 6);
      const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      const entries = repository.all({ memberId: target, from: weekStart, to: weekEnd });
      const rowsByProject = new Map();
      const dayTotals = {};
      const statusSummary = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
      for (const e of entries) {
        if (!rowsByProject.has(e.project_id)) {
          rowsByProject.set(e.project_id, {
            projectId: e.project_id,
            projectCode: e.project_code,
            projectName: e.project_name,
            cells: {},
            total: 0,
          });
        }
        const row = rowsByProject.get(e.project_id);
        row.cells[e.work_date] = (row.cells[e.work_date] ?? 0) + e.minutes;
        row.total += e.minutes;
        dayTotals[e.work_date] = (dayTotals[e.work_date] ?? 0) + e.minutes;
        statusSummary[e.status] += 1;
      }
      return {
        member: { id: member.id, name: member.name },
        isOwn: target === own,
        weekStart,
        weekEnd,
        days,
        rows: [...rowsByProject.values()].sort((a, b) =>
          a.projectCode.localeCompare(b.projectCode),
        ),
        dayTotals,
        total: entries.reduce((acc, e) => acc + e.minutes, 0),
        statusSummary,
        entries: entries.map(toDto),
      };
    },

    /** Proyectos y tareas disponibles para registrar tiempo en una semana. */
    formOptions(actor, weekStart) {
      const memberId = ownMember(actor);
      return {
        projects: repository.assignedProjects(memberId, weekStart, addDays(weekStart, 6)),
        tasks: repository.openTasksFor(memberId),
      };
    },

    /** RF-52: el autor envía un registro (draft o rejected → submitted). */
    submit(actor, id) {
      const before = requireOwn(actor, id);
      requireEditable(before);
      db.transaction(() => {
        repository.setReview(id, { status: 'submitted' });
        audit(actor.id, id, 'status_change', { status: [before.status, 'submitted'] });
      })();
      return toDto(repository.findById(id));
    },

    /** RF-52: envía todos los registros editables del autor en la semana lunes–domingo de `week`. */
    submitWeek(actor, week) {
      const memberId = ownMember(actor);
      const from = mondayOf(week);
      const ids = repository.weekEditableIds(memberId, from, addDays(from, 6));
      db.transaction(() => {
        for (const id of ids) {
          const before = repository.findById(id);
          repository.setReview(id, { status: 'submitted' });
          audit(actor.id, id, 'status_change', { status: [before.status, 'submitted'] });
        }
      })();
      return { submitted: ids.length, weekStart: from };
    },

    /** Registros enviados que este usuario puede revisar (admin: todos; líder: los de sus proyectos). */
    pending(actor) {
      if (actor.role === 'admin') return repository.submittedAll().map(toDto);
      const memberId = repository.memberOfUser(actor.id);
      return memberId === null ? [] : repository.submittedForManager(memberId).map(toDto);
    },

    /** RF-54: solo el líder del proyecto o un admin modifican la bandera facturable. */
    setBillable(actor, id, isBillable) {
      const before = repository.findById(id);
      if (!before) throw AppError.notFound('Registro de tiempo no encontrado');
      const memberId = repository.memberOfUser(actor.id);
      const isLeader = memberId !== null && before.project_manager_id === memberId;
      if (actor.role !== 'admin' && !isLeader) {
        throw AppError.forbidden(
          'Solo el líder del proyecto o un administrador puede cambiar la bandera facturable',
        );
      }
      if ((before.is_billable === 1) !== isBillable) {
        db.transaction(() => {
          repository.update(id, { isBillable });
          audit(actor.id, id, 'update', { is_billable: [before.is_billable, Number(isBillable)] });
        })();
      }
      return toDto(repository.findById(id));
    },

    /** Aprueba o rechaza: solo el líder del proyecto o un admin, y nunca los propios registros. */
    review(actor, id, decision, reason = null) {
      const row = repository.findById(id);
      if (!row) throw AppError.notFound('Registro de tiempo no encontrado');
      const memberId = repository.memberOfUser(actor.id);
      const isLeader = memberId !== null && row.project_manager_id === memberId;
      if (actor.role !== 'admin' && !isLeader) {
        throw AppError.forbidden(
          'Solo el líder del proyecto o un administrador puede revisar este registro',
        );
      }
      if (memberId !== null && row.team_member_id === memberId) {
        throw AppError.businessRule('No puedes revisar tus propios registros');
      }
      if (row.status !== 'submitted') {
        throw AppError.businessRule('Solo se pueden revisar registros enviados');
      }
      const approved = decision === 'approve';
      db.transaction(() => {
        repository.setReview(
          id,
          approved
            ? { status: 'approved', approvedBy: actor.id, approvedAt: nowIso() }
            : { status: 'rejected', rejectionReason: reason },
        );
        audit(actor.id, id, 'status_change', {
          status: ['submitted', approved ? 'approved' : 'rejected'],
        });
      })();
      return toDto(repository.findById(id));
    },

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
