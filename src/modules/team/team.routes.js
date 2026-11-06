import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createTeamRepository } from './team.repository.js';
import { createTeamService } from './team.service.js';
import { createSkillsRepository } from './skills.repository.js';
import { createSkillsService } from './skills.service.js';
import { createTimeOffRepository } from './timeoff.repository.js';
import { createTimeOffService } from './timeoff.service.js';
import { createTeamController } from './team.controller.js';

/** Equipo: lectura para todo usuario autenticado; escritura solo `admin` y `pm`. */
export function createTeamRouter({ db }) {
  const c = createTeamController({
    service: createTeamService({ db, repository: createTeamRepository(db) }),
    skills: createSkillsService({ db, repository: createSkillsRepository(db) }),
    timeOff: createTimeOffService({ db, repository: createTimeOffRepository(db) }),
  });
  const canWrite = requireRole('admin', 'pm');

  const api = Router();
  api.use(requireAuth);
  api.get('/', c.apiList);
  api.post('/', canWrite, c.apiCreate);
  api.get('/:id', c.apiGet);
  api.patch('/:id', canWrite, c.apiUpdate);
  api.get('/:id/skills', c.apiSkillsList);
  api.post('/:id/skills', canWrite, c.apiSkillAssign);
  api.delete('/:id/skills/:skillId', canWrite, c.apiSkillRemove);
  api.get('/:id/time-off', c.apiTimeOffList);
  api.post('/:id/time-off', canWrite, c.apiTimeOffCreate);
  api.patch('/:id/time-off/:offId', canWrite, c.apiTimeOffUpdate);
  api.delete('/:id/time-off/:offId', canWrite, c.apiTimeOffRemove);

  const html = Router();
  html.use(requireAuth);
  html.get('/', c.htmlList);
  html.get('/new', canWrite, c.htmlNew);
  html.post('/', canWrite, c.htmlCreate);
  html.get('/:id', c.htmlEdit);
  html.post('/:id', canWrite, c.htmlUpdate);
  html.post('/:id/skills', canWrite, c.htmlSkillAssign);
  html.post('/:id/skills/:skillId/delete', canWrite, c.htmlSkillRemove);
  html.post('/:id/time-off', canWrite, c.htmlTimeOffCreate);
  html.post('/:id/time-off/:offId/delete', canWrite, c.htmlTimeOffRemove);

  const router = Router();
  router.use('/api/v1/team-members', api);
  router.use('/team', html);
  return router;
}
