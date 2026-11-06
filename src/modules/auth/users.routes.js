import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { createUsersRepository } from './users.repository.js';
import { createUsersService } from './users.service.js';
import { createUsersController } from './users.controller.js';

/** Administración de usuarios (RF-03, RF-04): API JSON y vistas, solo para `admin`. */
export function createUsersRouter({ db, sessionStore, bcryptCost }) {
  const c = createUsersController({
    service: createUsersService({
      db,
      repository: createUsersRepository(db),
      sessionStore,
      bcryptCost,
    }),
    sessionStore,
  });
  const adminOnly = [requireAuth, requireRole('admin')];

  const api = Router();
  api.use(adminOnly);
  api.get('/', c.apiList);
  api.post('/', c.apiCreate);
  api.get('/:id', c.apiGet);
  api.patch('/:id', c.apiUpdate);
  api.delete('/:id', c.apiDeactivate);

  const html = Router();
  html.use(adminOnly);
  html.get('/', c.htmlList);
  html.get('/new', c.htmlNew);
  html.post('/', c.htmlCreate);
  html.get('/:id', c.htmlEdit);
  html.post('/:id', c.htmlUpdate);

  // Cuenta propia (RF-05): cualquier usuario autenticado.
  const me = Router();
  me.use(requireAuth);
  me.patch('/password', c.apiChangeOwnPassword);
  const account = Router();
  account.use(requireAuth);
  account.get('/password', c.passwordForm);
  account.post('/password', c.passwordSubmit);

  const router = Router();
  router.use('/api/v1/me', me);
  router.use('/account', account);
  router.use('/api/v1/users', api);
  router.use('/admin/users', html);
  return router;
}
