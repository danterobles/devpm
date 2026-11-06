import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createProjectsRepository } from './projects.repository.js';
import { createProjectsService } from './projects.service.js';
import { createMilestonesRepository } from './milestones.repository.js';
import { createMilestonesService } from './milestones.service.js';
import { createAssignmentsRepository } from '../assignments/assignments.repository.js';
import { createAssignmentsService } from '../assignments/assignments.service.js';
import { createProjectsController } from './projects.controller.js';

/** Proyectos: lectura para todo usuario autenticado; escritura solo `admin` y `pm`. */
export function createProjectsRouter({ db, timezone }) {
  const c = createProjectsController({
    service: createProjectsService({ db, repository: createProjectsRepository(db), timezone }),
    assignments: createAssignmentsService({ db, repository: createAssignmentsRepository(db) }),
    milestones: createMilestonesService({ db, repository: createMilestonesRepository(db) }),
  });
  const canWrite = requireRole('admin', 'pm');

  const api = Router();
  api.use(requireAuth);
  api.get('/', c.apiList);
  api.post('/', canWrite, c.apiCreate);
  api.get('/:id', c.apiGet);
  api.patch('/:id', canWrite, c.apiUpdate);
  api.post('/:id/status', canWrite, c.apiChangeStatus);
  api.get('/:id/assignments', c.apiAssignmentsList);
  api.post('/:id/assignments', canWrite, c.apiAssignmentCreate);
  api.patch('/:id/assignments/:aId', canWrite, c.apiAssignmentUpdate);
  api.delete('/:id/assignments/:aId', canWrite, c.apiAssignmentRemove);
  api.get('/:id/milestones', c.apiMilestonesList);
  api.post('/:id/milestones', canWrite, c.apiMilestoneCreate);
  api.patch('/:id/milestones/:msId', canWrite, c.apiMilestoneUpdate);
  api.delete('/:id/milestones/:msId', canWrite, c.apiMilestoneRemove);

  const html = Router();
  html.use(requireAuth);
  html.get('/', c.htmlList);
  html.get('/new', canWrite, c.htmlNew);
  html.post('/', canWrite, c.htmlCreate);
  html.get('/:id', c.htmlEdit);
  html.post('/:id', canWrite, c.htmlUpdate);
  html.post('/:id/status', canWrite, c.htmlChangeStatus);
  html.post('/:id/assignments', canWrite, c.htmlAssignmentCreate);
  html.post('/:id/assignments/:aId/delete', canWrite, c.htmlAssignmentRemove);
  html.post('/:id/milestones', canWrite, c.htmlMilestoneCreate);
  html.post('/:id/milestones/:msId/status', canWrite, c.htmlMilestoneStatus);
  html.post('/:id/milestones/:msId/delete', canWrite, c.htmlMilestoneRemove);

  const router = Router();
  router.use('/api/v1/projects', api);
  router.use('/projects', html);
  return router;
}
