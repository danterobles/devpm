import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';
import { diffDays } from '../../lib/dates.js';

const toDto = (r) => ({
  id: r.id,
  teamMemberId: r.team_member_id,
  type: r.type,
  startDate: r.start_date,
  endDate: r.end_date,
  days: diffDays(r.start_date, r.end_date) + 1, // días naturales, extremos incluidos
  notes: r.notes,
});

/** Ausencias por miembro (RF-22). Los traslapes se permiten con advertencia (DATA §3.5). */
export function createTimeOffService({ db, repository, events = null }) {
  function requireMember(memberId) {
    if (!repository.memberExists(memberId)) throw AppError.notFound('Miembro no encontrado');
  }
  function requireTimeOff(memberId, id) {
    requireMember(memberId);
    const row = repository.findById(memberId, id);
    if (!row) throw AppError.notFound('Ausencia no encontrada');
    return row;
  }
  const warningsFor = (memberId, row) => {
    const ids = repository.overlappingIds(memberId, row.start_date, row.end_date, row.id);
    return ids.length === 0
      ? []
      : [
          {
            code: 'TIME_OFF_OVERLAP',
            message: 'La ausencia se traslapa con otras del mismo miembro',
            overlapsWith: ids,
          },
        ];
  };

  return {
    list(memberId, range = {}) {
      requireMember(memberId);
      return repository.list(memberId, range).map(toDto);
    },

    create(actorId, memberId, input) {
      requireMember(memberId);
      const id = db.transaction(() => {
        const newId = repository.insert(memberId, input);
        recordAudit(db, {
          userId: actorId,
          entity: 'time_off',
          entityId: newId,
          action: 'create',
          changes: {
            type: [null, input.type],
            startDate: [null, input.startDate],
            endDate: [null, input.endDate],
          },
        });
        return newId;
      })();
      events?.emit('time_off.changed', { memberId });
      const row = repository.findById(memberId, id);
      return { data: toDto(row), warnings: warningsFor(memberId, row) };
    },

    update(actorId, memberId, id, input) {
      const before = requireTimeOff(memberId, id);
      const start = input.startDate ?? before.start_date;
      const end = input.endDate ?? before.end_date;
      if (end < start) {
        throw AppError.validation('Datos inválidos', [
          { field: 'endDate', message: 'La fecha final no puede ser anterior a la inicial' },
        ]);
      }
      db.transaction(() => {
        repository.update(id, input);
        const changes = diff(before, repository.findById(memberId, id));
        if (Object.keys(changes).length > 0) {
          recordAudit(db, {
            userId: actorId,
            entity: 'time_off',
            entityId: id,
            action: 'update',
            changes,
          });
        }
      })();
      events?.emit('time_off.changed', { memberId });
      const row = repository.findById(memberId, id);
      return { data: toDto(row), warnings: warningsFor(memberId, row) };
    },

    remove(actorId, memberId, id) {
      const before = requireTimeOff(memberId, id);
      db.transaction(() => {
        repository.remove(id);
        recordAudit(db, {
          userId: actorId,
          entity: 'time_off',
          entityId: id,
          action: 'delete',
          changes: {
            type: [before.type, null],
            startDate: [before.start_date, null],
            endDate: [before.end_date, null],
          },
        });
      })();
      events?.emit('time_off.changed', { memberId });
    },
  };
}
