import { Router } from 'express';
import { requireRole } from '../../middlewares/requireRole.js';
import { createCommentsController } from './comments.controller.js';

/**
 * Comentarios: leer es para cualquier usuario autenticado; escribir exige `admin`, `pm` o `developer`
 * y el service comprueba además que el developer esté asignado al proyecto de la tarea.
 */
export function createCommentsRouter({ service, repository }) {
  const c = createCommentsController({ service, repository });
  const write = requireRole('admin', 'pm', 'developer');
  const router = Router();
  router.get('/api/v1/tasks/:id/comments', c.apiList);
  router.post('/api/v1/tasks/:id/comments', write, c.apiCreate);
  router.patch('/api/v1/comments/:id', write, c.apiUpdate);
  router.delete('/api/v1/comments/:id', write, c.apiRemove);

  router.post('/tasks/:id/comments', write, c.htmlCreate);
  router.post('/comments/:id', write, c.htmlUpdate);
  router.post('/comments/:id/delete', write, c.htmlRemove);
  return router;
}
