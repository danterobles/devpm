import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createTasksRepository } from './tasks.repository.js';
import { createSnapshotsService } from '../burndown/snapshots.service.js';
import { createTasksService } from './tasks.service.js';
import { createTasksController } from './tasks.controller.js';

/**
 * Tareas: lectura para todo usuario autenticado; crear/editar/borrar solo `admin` y `pm`.
 * El cambio de estado lo autoriza el service (un developer solo en sus propias tareas).
 */
export function createTasksRouter({ db, timezone }) {
  const c = createTasksController({
    service: createTasksService({
      db,
      repository: createTasksRepository(db),
      snapshots: createSnapshotsService({ db, timezone }),
    }),
  });
  const canWrite = requireRole('admin', 'pm');
  const canChangeStatus = requireRole('admin', 'pm', 'developer');

  const router = Router();
  router.use(
    [
      '/api/v1/projects/:id/tasks',
      '/api/v1/tasks',
      '/projects/:id/backlog',
      '/projects/:id/sprints/:sid/board',
      '/tasks',
    ],
    requireAuth,
  );
  router.get('/api/v1/projects/:id/tasks', c.apiList);
  router.post('/api/v1/projects/:id/tasks', canWrite, c.apiCreate);
  router.get('/api/v1/sprints/:id/board', c.apiBoard);
  router.get('/api/v1/tasks/:id', c.apiGet);
  router.get('/api/v1/tasks/:id/history', c.apiHistory);
  router.get('/api/v1/tasks/:id/dependencies', c.apiDependencies);
  router.post('/api/v1/tasks/:id/dependencies', canWrite, c.apiAddDependency);
  router.delete('/api/v1/tasks/:id/dependencies/:depId', canWrite, c.apiRemoveDependency);
  router.put('/api/v1/projects/:id/tasks/order', canWrite, c.apiReorder);
  router.patch('/api/v1/tasks/:id', canWrite, c.apiUpdate);
  router.post('/api/v1/tasks/:id/status', canChangeStatus, c.apiChangeStatus);
  router.delete('/api/v1/tasks/:id', canWrite, c.apiRemove);
  // Vistas
  router.get('/tasks/:id', c.htmlTask);
  router.post('/tasks/:id', canWrite, c.htmlTaskUpdate);
  router.post('/tasks/:id/status', canChangeStatus, c.htmlTaskStatus);
  router.post('/tasks/:id/subtasks', canWrite, c.htmlSubtaskCreate);
  router.post('/tasks/:id/dependencies', canWrite, c.htmlDependencyAdd);
  router.post('/tasks/:id/dependencies/:depId/delete', canWrite, c.htmlDependencyRemove);
  router.post('/tasks/:id/delete', canWrite, c.htmlTaskDelete);
  router.get('/projects/:id/sprints/:sid/board', c.htmlBoard);
  router.post(
    '/projects/:id/sprints/:sid/board/:taskId/status',
    canChangeStatus,
    c.htmlBoardStatus,
  );
  router.get('/projects/:id/backlog', c.htmlBacklog);
  router.post('/projects/:id/backlog', canWrite, c.htmlBacklogCreate);
  router.post('/projects/:id/backlog/:taskId/move', canWrite, c.htmlBacklogMove);
  router.post('/projects/:id/backlog/:taskId/sprint', canWrite, c.htmlBacklogSprint);
  return router;
}
