import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createSprintsRepository } from './sprints.repository.js';
import { createSnapshotsService } from '../burndown/snapshots.service.js';
import { createSprintsService } from './sprints.service.js';
import { createSprintsController } from './sprints.controller.js';

/** Sprints: lectura para todo usuario autenticado; escritura solo `admin` y `pm`. */
export function createSprintsRouter({ db, timezone, events }) {
  const c = createSprintsController({
    service: createSprintsService({
      db,
      repository: createSprintsRepository(db),
      snapshots: createSnapshotsService({ db, timezone }),
      events,
    }),
  });
  const canWrite = requireRole('admin', 'pm');

  const router = Router();
  router.use(
    ['/api/v1/projects/:id/sprints', '/api/v1/sprints', '/projects/:id/sprints'],
    requireAuth,
  );
  // API
  router.get('/api/v1/projects/:id/sprints', c.apiList);
  router.post('/api/v1/projects/:id/sprints', canWrite, c.apiCreate);
  router.get('/api/v1/sprints/:id', c.apiGet);
  router.patch('/api/v1/sprints/:id', canWrite, c.apiUpdate);
  router.post('/api/v1/sprints/:id/start', canWrite, c.apiStart);
  router.post('/api/v1/sprints/:id/close', canWrite, c.apiClose);
  router.delete('/api/v1/sprints/:id', canWrite, c.apiRemove);
  // Vistas
  router.get('/projects/:id/sprints', c.htmlIndex);
  router.post('/projects/:id/sprints', canWrite, c.htmlCreate);
  router.post('/projects/:id/sprints/:sid/start', canWrite, c.htmlStart);
  router.post('/projects/:id/sprints/:sid/close', canWrite, c.htmlClose);
  router.post('/projects/:id/sprints/:sid/delete', canWrite, c.htmlRemove);
  return router;
}
