import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createClientsRepository } from './clients.repository.js';
import { createClientsService } from './clients.service.js';
import { createClientsController } from './clients.controller.js';

/** API de clientes: lectura para todo usuario autenticado; escritura solo `admin` y `pm`. */
export function createClientsRouter({ db, events }) {
  const c = createClientsController({
    service: createClientsService({ db, repository: createClientsRepository(db), events }),
  });
  const canWrite = requireRole('admin', 'pm');

  const api = Router();
  api.use(requireAuth);
  api.get('/', c.list);
  api.post('/', canWrite, c.create);
  api.get('/:id', c.get);
  api.get('/:id/summary', c.summary);
  api.patch('/:id', canWrite, c.update);

  // Vistas HTML: un juego de rutas por tipo de cliente.
  const html = Router();
  html.use(requireAuth);
  html.get('/', (_req, res) => res.redirect('/clients/internal'));
  for (const type of ['internal', 'external']) {
    const v = c.html(type);
    html.get(`/${type}`, v.list);
    html.get(`/${type}/new`, canWrite, v.newForm);
    html.post(`/${type}`, canWrite, v.create);
    html.get(`/${type}/:id`, v.edit);
    html.post(`/${type}/:id`, canWrite, v.update);
  }

  const router = Router();
  router.use('/api/v1/clients', api);
  router.use('/clients', html);
  return router;
}
