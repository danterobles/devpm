import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';
import { nowIso } from '../../lib/dates.js';

const toDto = (r) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  dueDate: r.due_date,
  status: r.status,
  completedAt: r.completed_at,
});

/** Hitos por proyecto (RF-32). */
export function createMilestonesService({ db, repository, events = null }) {
  function requireProject(projectId) {
    if (!repository.projectExists(projectId)) throw AppError.notFound('Proyecto no encontrado');
  }
  function requireMilestone(projectId, id) {
    requireProject(projectId);
    const row = repository.findById(projectId, id);
    if (!row) throw AppError.notFound('Hito no encontrado');
    return row;
  }

  return {
    list(projectId) {
      requireProject(projectId);
      return repository.listByProject(projectId).map(toDto);
    },

    create(actorId, projectId, input) {
      requireProject(projectId);
      const id = db.transaction(() => {
        const newId = repository.insert(projectId, input);
        recordAudit(db, {
          userId: actorId,
          entity: 'milestone',
          entityId: newId,
          action: 'create',
          changes: { name: [null, input.name], dueDate: [null, input.dueDate] },
        });
        return newId;
      })();
      events?.emit('milestone.updated', { projectId });
      return toDto(repository.findById(projectId, id));
    },

    /** Al pasar a `completed` se guarda `completed_at`; al salir de ese estado se limpia. */
    update(actorId, projectId, id, input) {
      const before = requireMilestone(projectId, id);
      const fields = { ...input };
      if (input.status === 'completed' && before.status !== 'completed') {
        fields.completedAt = nowIso();
      }
      db.transaction(() => {
        repository.update(id, fields);
        if (input.status !== undefined && input.status !== 'completed') {
          repository.clearCompletedAt(id);
        }
        const changes = diff(before, repository.findById(projectId, id));
        delete changes.completed_at;
        if (Object.keys(changes).length > 0) {
          recordAudit(db, {
            userId: actorId,
            entity: 'milestone',
            entityId: id,
            action: input.status && input.status !== before.status ? 'status_change' : 'update',
            changes,
          });
        }
      })();
      events?.emit('milestone.updated', { projectId });
      return toDto(repository.findById(projectId, id));
    },

    remove(actorId, projectId, id) {
      const before = requireMilestone(projectId, id);
      db.transaction(() => {
        repository.remove(id);
        recordAudit(db, {
          userId: actorId,
          entity: 'milestone',
          entityId: id,
          action: 'delete',
          changes: { name: [before.name, null], dueDate: [before.due_date, null] },
        });
      })();
      events?.emit('milestone.updated', { projectId });
    },
  };
}
