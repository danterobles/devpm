import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createClientsRepository } from './clients.repository.js';
import { createClientsService } from './clients.service.js';
import { createClientsController } from './clients.controller.js';

/** API de clientes: lectura para todo usuario autenticado; escritura solo `admin` y `pm`. */
export function createClientsRouter({ db }) {
  const c = createClientsController({
    service: createClientsService({ db, repository: createClientsRepository(db) }),
  });
  const canWrite = requireRole('admin', 'pm');

  const api = Router();
  api.use(requireAuth);
  api.get('/', c.list);
  api.post('/', canWrite, c.create);
  api.get('/:id', c.get);
  api.patch('/:id', canWrite, c.update);

  const router = Router();
  router.use('/api/v1/clients', api);
  return router;
}
