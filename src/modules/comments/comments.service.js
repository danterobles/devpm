import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';

const MENTION = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const excerpt = (text) => (text.length > 140 ? `${text.slice(0, 137)}…` : text);

export const toDto = (r) => ({
  id: r.id,
  taskId: r.task_id,
  userId: r.user_id,
  authorName: r.author_name ?? 'Usuario eliminado',
  body: r.body,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  isEdited: r.edited_at !== null,
});

/**
 * Comentarios y menciones de tareas (PRD §5.15). Comentan `admin`, `pm` y los `developer` asignados
 * al proyecto; el autor edita y elimina lo suyo y el `admin` elimina cualquier comentario.
 */
export function createCommentsService({ db, repository, events = null, notifier = null }) {
  function requireTask(taskId) {
    const task = repository.findTask(taskId);
    if (!task) throw AppError.notFound('Tarea no encontrada');
    return task;
  }
  function requireComment(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Comentario no encontrado');
    return row;
  }
  /** ¿Puede esta persona escribir en la conversación de la tarea? */
  function canComment(actor, task) {
    if (['admin', 'pm'].includes(actor.role)) return true;
    if (actor.role !== 'developer') return false;
    const memberId = repository.memberOfUser(actor.id);
    return memberId !== null && repository.isAssigned(task.project_id, memberId);
  }
  function assertCanComment(actor, task) {
    if (!canComment(actor, task)) {
      throw AppError.forbidden('Solo el equipo asignado al proyecto puede comentar');
    }
  }
  const audit = (actorId, id, action, changes) =>
    recordAudit(db, { userId: actorId, entity: 'task_comment', entityId: id, action, changes });

  function notifyComment(actor, task, id, body) {
    if (!notifier) return;
    const mentioned = new Set();
    for (const [, email] of body.matchAll(MENTION)) {
      const userId = repository.activeUserIdByEmail(email);
      if (userId !== null) mentioned.add(userId);
    }
    const link = `/tasks/${task.id}#comentarios`;
    notifier.notify({
      userIds: [...mentioned],
      type: 'task_mention',
      title: 'Te mencionaron en una tarea',
      body: `${actor.fullName ?? 'Alguien'} en «${task.title}»: ${excerpt(body)}`,
      link,
      dedupeKey: `mention:${id}`,
      exceptUserId: actor.id,
    });
    const interested = [
      notifier.userOfMember(task.assignee_id),
      ...notifier.leaderUserIds(task.project_id),
    ].filter((u) => u != null && !mentioned.has(u));
    notifier.notify({
      userIds: interested,
      type: 'task_comment',
      title: 'Nuevo comentario',
      body: `${actor.fullName ?? 'Alguien'} en «${task.title}»: ${excerpt(body)}`,
      link,
      dedupeKey: `comment:${id}`,
      exceptUserId: actor.id,
    });
  }

  return {
    /** Conversación de la tarea y si esta persona puede escribir (para la vista). */
    view(actor, taskId) {
      const task = requireTask(taskId);
      return {
        items: repository.listByTask(taskId).map((r) => ({
          ...toDto(r),
          canEdit: r.user_id === actor.id,
          canDelete: r.user_id === actor.id || actor.role === 'admin',
        })),
        canComment: canComment(actor, task),
      };
    },
    list(taskId) {
      requireTask(taskId);
      return repository.listByTask(taskId).map(toDto);
    },

    create(actor, taskId, input) {
      const task = requireTask(taskId);
      assertCanComment(actor, task);
      const id = db.transaction(() => {
        const newId = repository.insert(taskId, actor.id, input.body);
        audit(actor.id, newId, 'create', { taskId: [null, taskId] });
        return newId;
      })();
      events?.emit('comment.changed', { projectId: task.project_id, taskId });
      notifyComment(actor, task, id, input.body);
      return toDto(repository.findById(id));
    },

    update(actor, id, input) {
      const before = requireComment(id);
      if (before.user_id !== actor.id)
        throw AppError.forbidden('Solo el autor puede editar su comentario');
      const task = requireTask(before.task_id);
      assertCanComment(actor, task); // quien ya no pertenece al proyecto no edita
      if (input.body !== before.body) {
        db.transaction(() => {
          repository.update(id, input.body);
          audit(actor.id, id, 'update', diff({ body: before.body }, { body: input.body }));
        })();
        events?.emit('comment.changed', { projectId: task.project_id, taskId: task.id });
      }
      return toDto(repository.findById(id));
    },

    remove(actor, id) {
      const before = requireComment(id);
      if (before.user_id !== actor.id && actor.role !== 'admin') {
        throw AppError.forbidden('Solo el autor o un administrador puede eliminar el comentario');
      }
      const task = requireTask(before.task_id);
      db.transaction(() => {
        repository.remove(id);
        audit(actor.id, id, 'delete', { body: [before.body, null] });
      })();
      events?.emit('comment.changed', { projectId: task.project_id, taskId: task.id });
    },
  };
}
