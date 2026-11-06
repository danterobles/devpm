import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createProjectsRepository } from './projects.repository.js';
import { createProjectsService } from './projects.service.js';
import { createProjectsController } from './projects.controller.js';

/** Proyectos: lectura para todo usuario autenticado; escritura solo `admin` y `pm`. */
export function createProjectsRouter({ db }) {
  const c = createProjectsController({
    service: createProjectsService({ db, repository: createProjectsRepository(db) }),
  });
  const canWrite = requireRole('admin', 'pm');

  const api = Router();
  api.use(requireAuth);
  api.get('/', c.apiList);
  api.post('/', canWrite, c.apiCreate);
  api.get('/:id', c.apiGet);
  api.patch('/:id', canWrite, c.apiUpdate);

  const html = Router();
  html.use(requireAuth);
  html.get('/', c.htmlList);
  html.get('/new', canWrite, c.htmlNew);
  html.post('/', canWrite, c.htmlCreate);
  html.get('/:id', c.htmlEdit);
  html.post('/:id', canWrite, c.htmlUpdate);

  const router = Router();
  router.use('/api/v1/projects', api);
  router.use('/projects', html);
  return router;
}
