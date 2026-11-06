import { Router } from 'express';
import { validateBody } from '../../middlewares/validate.js';
import { loginSchema } from './auth.schemas.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import { createAuthController } from './auth.controller.js';

export function createAuthRouter({ db }) {
  const controller = createAuthController({
    service: createAuthService({ repository: createAuthRepository(db) }),
  });
  const router = Router();
  router.get('/login', controller.showLogin);
  router.post('/login', validateBody(loginSchema), controller.login);
  router.post('/logout', controller.logout);
  return router;
}
