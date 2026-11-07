import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { idSchema, listQuerySchema } from './notifications.schemas.js';
import { NOTIFICATION_TYPES } from './notifications.types.js';

const parseId = (raw) => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Notificación no encontrada');
  return parsed.data;
};
const uid = (req) => req.session.userId;
/** Solo rutas internas: nunca se redirige a un enlace externo. */
const safeLink = (link) =>
  typeof link === 'string' && /^\/(?!\/)/.test(link) ? link : '/notifications';

export function createNotificationsController({ service }) {
  return {
    apiList: (req, res) => {
      const query = parseWith(listQuerySchema, req.query);
      res.json(service.list(uid(req), { unreadOnly: query.unread, ...query }));
    },
    apiUnreadCount: (req, res) => res.json({ data: { unread: service.unreadCount(uid(req)) } }),
    apiRead: (req, res) => res.json({ data: service.markRead(uid(req), parseId(req.params.id)) }),
    apiReadAll: (req, res) => res.json({ data: { updated: service.markAllRead(uid(req)) } }),

    page(req, res) {
      const query = parseWith(listQuerySchema, req.query);
      const result = service.list(uid(req), { unreadOnly: query.unread, ...query });
      res.render('pages/notifications/index', {
        title: 'Notificaciones',
        items: result.data,
        meta: result.meta,
        unreadOnly: query.unread,
        unread: service.unreadCount(uid(req)),
      });
    },
    open(req, res) {
      const item = service.markRead(uid(req), parseId(req.params.id));
      res.redirect(safeLink(item.link));
    },
    readAll(req, res) {
      service.markAllRead(uid(req));
      res.redirect('/notifications');
    },

    preferencesForm: (req, res, extra = {}) =>
      res.render('pages/notifications/preferences', {
        title: 'Preferencias de notificaciones',
        emailEnabled: service.emailPreference(uid(req)),
        types: service.preferences(uid(req)),
        mailAvailable: Boolean(req.app.locals.mailer?.enabled),
        done: false,
        ...extra,
      }),
    preferencesSubmit(req, res) {
      service.setEmailPreference(uid(req), req.body?.emailNotifications === '1');
      // Una casilla por tipo y canal: `in_<tipo>` (en la aplicación) y `mail_<tipo>` (por correo)
      const choices = Object.fromEntries(
        Object.keys(NOTIFICATION_TYPES).map((type) => [
          type,
          { inApp: req.body?.[`in_${type}`] === '1', email: req.body?.[`mail_${type}`] === '1' },
        ]),
      );
      service.setPreferences(uid(req), choices);
      return res.redirect('/account/notifications?saved=1');
    },
  };
}
