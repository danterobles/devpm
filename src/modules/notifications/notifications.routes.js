import { Router } from 'express';
import { createNotificationsController } from './notifications.controller.js';

/** Cada persona solo ve y modifica sus propias notificaciones (el service filtra por usuario). */
export function createNotificationsRouter({ service }) {
  const c = createNotificationsController({ service });
  const router = Router();
  router.get('/api/v1/notifications', c.apiList);
  router.get('/api/v1/notifications/unread-count', c.apiUnreadCount);
  router.post('/api/v1/notifications/read-all', c.apiReadAll);
  router.post('/api/v1/notifications/:id/read', c.apiRead);

  router.get('/notifications', c.page);
  router.post('/notifications/read-all', c.readAll);
  router.post('/notifications/:id/open', c.open);

  router.get('/account/notifications', (req, res) =>
    c.preferencesForm(req, res, { done: req.query.saved === '1' }),
  );
  router.post('/account/notifications', c.preferencesSubmit);
  return router;
}
