import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { validateBody } from '../../middlewares/validate.js';
import { loginSchema } from './auth.schemas.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import { createAuthController } from './auth.controller.js';

export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const accountKey = (email) =>
  `cuenta:${String(email ?? '')
    .trim()
    .toLowerCase()}`;

export function createAuthRouter({
  db,
  loginLimit = LOGIN_MAX_ATTEMPTS,
  logger = null,
  securityEvents = null,
  accountSecurity = null,
}) {
  const repository = createAuthRepository(db);
  const controller = createAuthController({
    service: createAuthService({ repository }),
    logger,
    securityEvents,
    accountSecurity,
    repository,
  });
  const blocked = (scope) => (req, res) => {
    const email = String(req.body?.email ?? '').slice(0, 254);
    logger?.warn(
      { event: 'login.blocked', scope, ip: req.ip, email },
      'Inicio de sesión bloqueado por exceso de intentos',
    );
    securityEvents?.record('login_blocked', { email, ip: req.ip, detail: scope });
    res.status(429).render('pages/auth/login', {
      title: 'Iniciar sesión',
      error: 'Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.',
      email: '',
      notice: null,
      mailAvailable: Boolean(accountSecurity?.mailAvailable()),
    });
  };
  // Solo cuentan los intentos fallidos: un login correcto no consume cupo.
  const loginLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: loginLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: blocked('ip'),
  });
  // También por cuenta (el doble): frena ataques repartidos entre muchas IP contra un mismo correo.
  const accountLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: loginLimit * 2,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => accountKey(req.body?.email),
    handler: blocked('cuenta'),
  });
  // Segundo paso: se limita por IP y por la cuenta que está verificando (sesión intermedia).
  const twoFactorBlocked = (req, res) => {
    securityEvents?.record('login_blocked', {
      ip: req.ip,
      userId: req.session?.twoFactorUserId ?? null,
      detail: '2fa',
    });
    res.status(429).render('pages/auth/twofa', {
      title: 'Verificación en dos pasos',
      error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.',
    });
  };
  const twoFactorIpLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: loginLimit,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
    handler: twoFactorBlocked,
  });
  const twoFactorUserLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: loginLimit,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => `2fa:${req.session?.twoFactorUserId ?? 'ninguna'}`,
    handler: twoFactorBlocked,
  });

  const router = Router();
  router.get('/login', controller.showLogin);
  router.post('/login', loginLimiter, accountLimiter, validateBody(loginSchema), controller.login);
  router.get('/login/2fa', controller.showTwoFactor);
  router.post('/login/2fa', twoFactorIpLimiter, twoFactorUserLimiter, controller.twoFactor);
  router.post('/logout', controller.logout);
  /** Quita el bloqueo por intentos fallidos de una cuenta (RF-165). */
  router.unlockAccount = (email) => accountLimiter.resetKey(accountKey(email));
  return router;
}
