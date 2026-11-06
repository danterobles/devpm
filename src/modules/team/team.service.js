import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';

/** Fila → DTO. El costo por hora solo se incluye si `includeCost` (admin y pm). */
export function toDto(r, { includeCost = false } = {}) {
  const dto = {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    fullName: `${r.first_name} ${r.last_name}`,
    email: r.email,
    position: r.position,
    seniority: r.seniority,
    weeklyCapacityMinutes: r.weekly_capacity_minutes,
    hireDate: r.hire_date,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (includeCost) dto.hourlyCostCents = r.hourly_cost_cents;
  return dto;
}

/** Casos de uso del equipo de desarrollo (RF-20). */
export function createTeamService({ db, repository }) {
  function requireMember(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Miembro no encontrado');
    return row;
  }
  function checkEmail(email, exceptId = null) {
    const owner = repository.findIdByEmail(email);
    if (owner !== null && owner !== exceptId)
      throw AppError.conflict('El correo ya está registrado');
  }

  return {
    list(query, opts) {
      const { rows, total } = repository.list(query);
      return {
        data: rows.map((r) => toDto(r, opts)),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    },

    get: (id, opts) => toDto(requireMember(id), opts),

    create(actorId, input) {
      checkEmail(input.email);
      const id = db.transaction(() => {
        const newId = repository.insert(input);
        recordAudit(db, {
          userId: actorId,
          entity: 'team_member',
          entityId: newId,
          action: 'create',
          changes: { email: [null, input.email], position: [null, input.position] },
        });
        return newId;
      })();
      return toDto(repository.findById(id), { includeCost: true });
    },

    update(actorId, id, input) {
      const before = requireMember(id);
      if (input.email !== undefined) checkEmail(input.email, id);
      db.transaction(() => {
        repository.update(id, input);
        const changes = diff(before, repository.findById(id));
        if (Object.keys(changes).length > 0) {
          recordAudit(db, {
            userId: actorId,
            entity: 'team_member',
            entityId: id,
            action: 'update',
            changes,
          });
        }
      })();
      return toDto(repository.findById(id), { includeCost: true });
    },
  };
}
