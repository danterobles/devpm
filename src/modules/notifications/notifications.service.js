import { AppError } from '../../lib/AppError.js';
import { addDays, nowIso } from '../../lib/dates.js';

const RETENTION_DAYS = 90;

/**
 * Casos de uso de las notificaciones (PRD §5.12). `notify` es el único punto de entrada para
 * generar avisos: inserta con deduplicación, avisa por el bus de eventos y envía el correo sin
 * esperar su resultado.
 */
export function createNotificationsService({
  repository,
  events = null,
  mailer = null,
  appUrl = 'http://localhost:3000',
}) {
  /** Líder del proyecto: su usuario activo; si no tiene, todos los administradores activos. */
  function leaderUserIds(projectId) {
    const userId = repository.userOfMember(repository.managerOfProject(projectId));
    return userId === null ? repository.activeAdmins() : [userId];
  }

  function sendMail(userId, { title, body, link }) {
    if (!mailer?.enabled) return;
    const to = repository.recipient(userId);
    if (!to || to.email_notifications !== 1) return;
    const url = link ? `\n\n${appUrl}${link}` : '';
    void mailer.send({ to: to.email, subject: `[DevPM] ${title}`, text: `${body}${url}\n` });
  }

  return {
    leaderUserIds,
    userOfMember: (memberId) => repository.userOfMember(memberId),

    /**
     * @param {{ userIds: number[], type: string, title: string, body: string, link?: string|null,
     *   dedupeKey?: string|null, exceptUserId?: number|null }} notice
     * @returns {number} cuántas notificaciones se crearon
     */
    notify({ userIds, type, title, body, link = null, dedupeKey = null, exceptUserId = null }) {
      let created = 0;
      for (const userId of new Set(userIds)) {
        if (userId == null || userId === exceptUserId) continue;
        if (!repository.recipient(userId)) continue; // usuario inactivo o inexistente
        const id = repository.insert({ userId, type, title, body, link, dedupeKey });
        if (id === null) continue;
        created += 1;
        sendMail(userId, { title, body, link });
      }
      if (created > 0) events?.emit('notification.created');
      return created;
    },

    list: (userId, query) => {
      const { rows, total } = repository.list(userId, query);
      return { data: rows, meta: { page: query.page ?? 1, pageSize: query.pageSize ?? 20, total } };
    },
    unreadCount: (userId) => repository.unreadCount(userId),

    markRead(userId, id) {
      const found = repository.find(id, userId);
      if (!found) throw AppError.notFound('Notificación no encontrada');
      if (repository.markRead(id, userId)) events?.emit('notification.read');
      return repository.find(id, userId);
    },
    markAllRead(userId) {
      const changed = repository.markAllRead(userId);
      if (changed > 0) events?.emit('notification.read');
      return changed;
    },
    /** Elimina las leídas con más de 90 días. */
    prune(today = nowIso().slice(0, 10)) {
      return repository.prune(`${addDays(today, -RETENTION_DAYS)}T00:00:00.000Z`);
    },

    emailPreference: (userId) => repository.emailPreference(userId),
    setEmailPreference: (userId, enabled) => repository.setEmailPreference(userId, enabled),
  };
}
