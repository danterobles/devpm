import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createTeamRepository } from './team.repository.js';
import { createTeamService } from './team.service.js';
import { createTeamController } from './team.controller.js';

/** Equipo: lectura para todo usuario autenticado; escritura solo `admin` y `pm`. */
export function createTeamRouter({ db }) {
  const c = createTeamController({
    service: createTeamService({ db, repository: createTeamRepository(db) }),
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
  router.use('/api/v1/team-members', api);
  router.use('/team', html);
  return router;
}
