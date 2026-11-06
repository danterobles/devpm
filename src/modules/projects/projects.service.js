import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';

export const toDto = (r) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  clientId: r.client_id,
  clientName: r.client_name,
  clientType: r.client_type,
  managerId: r.manager_id,
  managerName: r.manager_name,
  status: r.status,
  priority: r.priority,
  methodology: r.methodology,
  startDate: r.start_date,
  endDate: r.end_date,
  actualStartDate: r.actual_start_date,
  actualEndDate: r.actual_end_date,
  budgetMinutes: r.budget_minutes,
  budgetCents: r.budget_cents,
  isBillable: r.is_billable === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Casos de uso de proyectos (RF-30, RF-34). */
export function createProjectsService({ db, repository }) {
  function requireProject(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Proyecto no encontrado');
    return row;
  }
  function requireActiveClient(clientId) {
    const client = repository.findClient(clientId);
    if (!client) throw AppError.businessRule('El cliente no existe');
    if (client.is_active !== 1) throw AppError.businessRule('El cliente está inactivo');
    return client;
  }
  function requireActiveManager(managerId) {
    if (managerId === null || managerId === undefined) return;
    const m = repository.findMember(managerId);
    if (!m) throw AppError.businessRule('El líder no existe');
    if (m.is_active !== 1) throw AppError.businessRule('El líder está inactivo');
  }

  return {
    list(query) {
      const { rows, total } = repository.list(query);
      return { data: rows.map(toDto), meta: { page: query.page, pageSize: query.pageSize, total } };
    },
    get: (id) => toDto(requireProject(id)),
    options: () => repository.options(),

    create(actorId, input) {
      const client = requireActiveClient(input.clientId);
      requireActiveManager(input.managerId);
      const id = db.transaction(() => {
        const year = input.startDate.slice(0, 4);
        const seq = String(repository.nextSequence(year)).padStart(3, '0');
        const code = `PRJ-${year}-${seq}`;
        const newId = repository.insert({
          ...input,
          code,
          isBillable: input.isBillable ?? client.type === 'external',
        });
        recordAudit(db, {
          userId: actorId,
          entity: 'project',
          entityId: newId,
          action: 'create',
          changes: { code: [null, code], name: [null, input.name] },
        });
        return newId;
      })();
      return toDto(repository.findById(id));
    },

    update(actorId, id, input) {
      const before = requireProject(id);
      const start = input.startDate ?? before.start_date;
      const end = input.endDate ?? before.end_date;
      if (end < start) {
        throw AppError.validation('Datos inválidos', [
          { field: 'endDate', message: 'La fecha final no puede ser anterior a la inicial' },
        ]);
      }
      if (input.clientId !== undefined && input.clientId !== before.client_id) {
        if (before.status !== 'planning') {
          throw AppError.businessRule(
            'El cliente solo se puede cambiar mientras el proyecto está en planeación',
          );
        }
        requireActiveClient(input.clientId);
      }
      if (input.managerId !== undefined && input.managerId !== before.manager_id) {
        requireActiveManager(input.managerId);
      }
      if (
        (input.startDate !== undefined || input.endDate !== undefined) &&
        repository.countAssignmentsOutside(id, start, end) > 0
      ) {
        throw AppError.businessRule(
          'Hay asignaciones fuera del nuevo rango de fechas del proyecto',
        );
      }
      db.transaction(() => {
        repository.update(id, input);
        const changes = diff(before, repository.findById(id));
        for (const k of ['client_name', 'client_type', 'manager_name']) delete changes[k];
        if (Object.keys(changes).length > 0) {
          recordAudit(db, {
            userId: actorId,
            entity: 'project',
            entityId: id,
            action: 'update',
            changes,
          });
        }
      })();
      return toDto(repository.findById(id));
    },
  };
}
