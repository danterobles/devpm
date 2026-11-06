import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';

export const toDto = (r) => ({
  id: r.id,
  projectId: r.project_id,
  teamMemberId: r.team_member_id,
  memberName: r.member_name,
  projectRole: r.project_role,
  allocationPercent: r.allocation_percent,
  startDate: r.start_date,
  endDate: r.end_date,
});

/** Asignaciones de miembros a proyectos (RF-40, RF-41). */
export function createAssignmentsService({ db, repository, events = null }) {
  function requireProject(projectId) {
    const p = repository.findProject(projectId);
    if (!p) throw AppError.notFound('Proyecto no encontrado');
    return p;
  }
  function requireAssignment(projectId, id) {
    requireProject(projectId);
    const row = repository.findById(projectId, id);
    if (!row) throw AppError.notFound('Asignación no encontrada');
    return row;
  }
  function checkPeriod(project, start, end) {
    if (end < start) {
      throw AppError.validation('Datos inválidos', [
        { field: 'endDate', message: 'La fecha final no puede ser anterior a la inicial' },
      ]);
    }
    if (start < project.start_date || end > project.end_date) {
      throw AppError.businessRule(
        `El periodo debe quedar dentro del proyecto (${project.start_date} a ${project.end_date})`,
      );
    }
  }
  /** RF-41: suma de dedicación del miembro en periodos traslapados (incluida esta asignación). */
  function overAllocation(row) {
    const others = repository.overlappingPercent(
      row.team_member_id,
      row.start_date,
      row.end_date,
      row.id,
    );
    const total = others + row.allocation_percent;
    return total > 100
      ? [
          {
            code: 'OVER_ALLOCATION',
            message: `El miembro queda asignado al ${total} % en el periodo`,
            teamMemberId: row.team_member_id,
            totalPercent: total,
          },
        ]
      : [];
  }

  return {
    list(projectId) {
      requireProject(projectId);
      return repository.listByProject(projectId).map(toDto);
    },

    create(actorId, projectId, input) {
      const project = requireProject(projectId);
      const member = repository.findMember(input.teamMemberId);
      if (!member) throw AppError.businessRule('El miembro no existe');
      if (member.is_active !== 1) throw AppError.businessRule('El miembro está inactivo');
      checkPeriod(project, input.startDate, input.endDate);
      const id = db.transaction(() => {
        const newId = repository.insert(projectId, input);
        recordAudit(db, {
          userId: actorId,
          entity: 'assignment',
          entityId: newId,
          action: 'create',
          changes: {
            teamMemberId: [null, input.teamMemberId],
            allocationPercent: [null, input.allocationPercent],
          },
        });
        return newId;
      })();
      events?.emit('assignment.changed', { projectId, teamMemberId: input.teamMemberId });
      const row = repository.findById(projectId, id);
      return { data: toDto(row), warnings: overAllocation(row) };
    },

    update(actorId, projectId, id, input) {
      const project = requireProject(projectId);
      const before = requireAssignment(projectId, id);
      checkPeriod(project, input.startDate ?? before.start_date, input.endDate ?? before.end_date);
      db.transaction(() => {
        repository.update(id, input);
        const changes = diff(before, repository.findById(projectId, id));
        delete changes.member_name;
        if (Object.keys(changes).length > 0) {
          recordAudit(db, {
            userId: actorId,
            entity: 'assignment',
            entityId: id,
            action: 'update',
            changes,
          });
        }
      })();
      events?.emit('assignment.changed', { projectId, teamMemberId: before.team_member_id });
      const row = repository.findById(projectId, id);
      return { data: toDto(row), warnings: overAllocation(row) };
    },

    remove(actorId, projectId, id) {
      const before = requireAssignment(projectId, id);
      db.transaction(() => {
        repository.remove(id);
        recordAudit(db, {
          userId: actorId,
          entity: 'assignment',
          entityId: id,
          action: 'delete',
          changes: { teamMemberId: [before.team_member_id, null] },
        });
      })();
      events?.emit('assignment.changed', { projectId, teamMemberId: before.team_member_id });
    },
  };
}
