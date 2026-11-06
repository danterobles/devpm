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
  router.use(['/api/v1/time-entries', '/api/v1/time-sheet', '/time'], requireAuth);
  router.use(['/api/v1/time-entries', '/api/v1/time-sheet', '/time'], access);
  router.get('/api/v1/time-sheet', c.sheetApi);
  router.get('/time', c.htmlSheet);
  router.post('/time/entries', c.htmlCreate);
  router.get('/time/entries/:id', c.htmlEntry);
  router.post('/time/entries/:id', c.htmlUpdate);
  router.post('/time/entries/:id/delete', c.htmlRemove);
  router.post('/time/entries/:id/submit', c.htmlSubmit);
  router.post('/time/submit-week', c.htmlSubmitWeek);
  router.get('/time/approvals', c.htmlApprovals);
  router.post('/time/approvals/:id/approve', c.htmlApprove);
  router.post('/time/approvals/:id/reject', c.htmlReject);
  router.get('/api/v1/time-entries', c.apiList);
  router.get('/api/v1/time-entries/pending', c.apiPending);
  router.post('/api/v1/time-entries/submit-week', c.apiSubmitWeek);
  router.post('/api/v1/time-entries', c.apiCreate);
  router.get('/api/v1/time-entries/:id', c.apiGet);
  router.patch('/api/v1/time-entries/:id', c.apiUpdate);
  router.delete('/api/v1/time-entries/:id', c.apiRemove);
  router.post('/api/v1/time-entries/:id/submit', c.apiSubmit);
  router.post('/api/v1/time-entries/:id/approve', c.apiApprove);
  router.post('/api/v1/time-entries/:id/reject', c.apiReject);
  return router;
}
