import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createTimeEntriesRepository } from './time-entries.repository.js';
import { createTimeEntriesService } from './time-entries.service.js';
import { createTimeEntriesController } from './time-entries.controller.js';

/**
 * Registro de tiempo: admin, pm y developer (con miembro vinculado). El viewer no accede.
 * La propiedad del registro y la aprobación las verifica el service.
 */
export function createTimeEntriesRouter({ db, timezone }) {
  const repository = createTimeEntriesRepository(db);
  const service = createTimeEntriesService({ db, repository, timezone });
  const c = createTimeEntriesController({ service });
  const access = requireRole('admin', 'pm', 'developer');

  const router = Router();
  router.use(['/api/v1/time-entries'], requireAuth);
  router.use('/api/v1/time-entries', access);
  router.get('/api/v1/time-entries', c.apiList);
  router.post('/api/v1/time-entries', c.apiCreate);
  router.get('/api/v1/time-entries/:id', c.apiGet);
  router.patch('/api/v1/time-entries/:id', c.apiUpdate);
  router.delete('/api/v1/time-entries/:id', c.apiRemove);
  return router;
}
