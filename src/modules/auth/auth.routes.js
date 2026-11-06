import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { validateBody } from '../../middlewares/validate.js';
import { loginSchema } from './auth.schemas.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import { createAuthController } from './auth.controller.js';

export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function createAuthRouter({ db, loginLimit = LOGIN_MAX_ATTEMPTS }) {
  const controller = createAuthController({
    service: createAuthService({ repository: createAuthRepository(db) }),
  });
  // Solo cuentan los intentos fallidos: un login correcto no consume cupo.
  const loginLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: loginLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).render('pages/auth/login', {
        title: 'Iniciar sesión',
        error: 'Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.',
        email: '',
      }),
  });
  const router = Router();
  router.get('/login', controller.showLogin);
  router.post('/login', loginLimiter, validateBody(loginSchema), controller.login);
  router.post('/logout', controller.logout);
  return router;
}
