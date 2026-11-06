import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';

/** Fila → DTO: solo expone las columnas propias del tipo del cliente. */
export function toDto(r) {
  const base = {
    id: r.id,
    type: r.type,
    name: r.name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    isActive: r.is_active === 1,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.type === 'internal') {
    return { ...base, department: r.department, costCenter: r.cost_center };
  }
  return {
    ...base,
    legalName: r.legal_name,
    taxId: r.tax_id,
    hourlyRateCents: r.hourly_rate_cents,
    currency: r.currency,
    address: r.address,
  };
}

/** Casos de uso de clientes internos y externos (RF-10, RF-15). */
export function createClientsService({ db, repository }) {
  function requireClient(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Cliente no encontrado');
    return row;
  }

  function checkTaxId(taxId, exceptId = null) {
    if (!taxId) return;
    const owner = repository.findIdByTaxId(taxId);
    if (owner !== null && owner !== exceptId) {
      throw AppError.conflict('El RFC / ID fiscal ya está registrado');
    }
  }

  return {
    list(query) {
      const { rows, total } = repository.list(query);
      return { data: rows.map(toDto), meta: { page: query.page, pageSize: query.pageSize, total } };
    },

    get: (id) => toDto(requireClient(id)),

    /** RF-12 / RF-17: proyectos del cliente con horas (enviadas + aprobadas) y monto estimado. */
    summary(id) {
      const client = requireClient(id);
      const projects = repository.projectsWithHours(id).map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        consumedMinutes: p.consumed,
        billableMinutes: p.billable,
      }));
      const sum = (key) => projects.reduce((acc, p) => acc + p[key], 0);
      const totals = {
        projects: projects.length,
        consumedMinutes: sum('consumedMinutes'),
        billableMinutes: sum('billableMinutes'),
      };
      if (client.type === 'external') {
        totals.estimatedAmountCents = Math.round(
          (totals.billableMinutes * client.hourly_rate_cents) / 60,
        );
        totals.currency = client.currency;
      }
      return { projects, totals };
    },

    create(actorId, input) {
      checkTaxId(input.taxId);
      const id = db.transaction(() => {
        const newId = repository.insert(input);
        recordAudit(db, {
          userId: actorId,
          entity: 'client',
          entityId: newId,
          action: 'create',
          changes: { type: [null, input.type], name: [null, input.name] },
        });
        return newId;
      })();
      return toDto(repository.findById(id));
    },

    update(actorId, id, input) {
      const before = requireClient(id);
      if (input.taxId !== undefined) checkTaxId(input.taxId, id);
      db.transaction(() => {
        repository.update(id, input);
        const changes = diff(before, repository.findById(id));
        if (Object.keys(changes).length > 0) {
          recordAudit(db, {
            userId: actorId,
            entity: 'client',
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
