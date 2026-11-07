import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { passwordSchema } from '../auth/users.schemas.js';

const WINDOW_MS = 15 * 60 * 1000;
const emailSchema = z.object({ email: z.string().trim().min(1).max(254) });
const resetSchema = z.object({
  token: z.string().max(200),
  newPassword: passwordSchema,
  confirmPassword: z.string().max(200),
});
const idSchema = z.coerce.number().int().positive();
const parseId = (raw) => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Usuario no encontrado');
  return parsed.data;
};
const detail = (err) => err.details?.[0]?.message ?? err.message;

/**
 * Rutas públicas de recuperación de contraseña (se montan antes de `requireAuth`). Las solicitudes se
 * limitan por IP y por correo para que no sirvan para saturar buzones ni para adivinar cuentas.
 */
export function createAccountPublicRouter({ service }) {
  const tooMany = (req, res) =>
    res.status(429).render('pages/auth/forgot', {
      title: 'Recuperar contraseña',
      error: 'Demasiadas solicitudes. Inténtalo de nuevo en unos minutos.',
      sent: false,
      mailAvailable: service.mailAvailable(),
    });
  const common = {
    windowMs: WINDOW_MS,
    standardHeaders: false,
    legacyHeaders: false,
    handler: tooMany,
  };
  const byIp = rateLimit({ ...common, limit: 5 });
  const byEmail = rateLimit({
    ...common,
    limit: 3,
    keyGenerator: (req) =>
      `reset:${String(req.body?.email ?? '')
        .trim()
        .toLowerCase()}`,
  });

  const forgot = (res, extra = {}) =>
    res.render('pages/auth/forgot', {
      title: 'Recuperar contraseña',
      error: null,
      sent: false,
      mailAvailable: service.mailAvailable(),
      ...extra,
    });
  const reset = (res, extra = {}) =>
    res.render('pages/auth/reset', { title: 'Nueva contraseña', error: null, token: '', ...extra });

  const router = Router();
  router.get('/forgot-password', (_req, res) => forgot(res));
  router.post('/forgot-password', byIp, byEmail, (req, res) => {
    const { email } = parseWith(emailSchema, req.body ?? {});
    const result = service.requestReset(email, req.ip);
    forgot(res, { sent: result.mailAvailable });
  });
  router.get('/reset-password', (req, res) => {
    const token = String(req.query.token ?? '');
    if (service.tokenUserId(token) === null) {
      return reset(res.status(400), {
        error: 'El enlace no es válido o ya venció. Pide uno nuevo.',
        token: '',
      });
    }
    return reset(res, { token });
  });
  router.post('/reset-password', async (req, res) => {
    const token = String(req.body?.token ?? '');
    try {
      const input = parseWith(resetSchema, { ...req.body, token });
      if (input.newPassword !== input.confirmPassword) {
        throw AppError.validation('Datos inválidos', [
          { field: 'confirmPassword', message: 'La confirmación no coincide' },
        ]);
      }
      await service.resetPassword(token, input.newPassword, req.ip);
      return res.redirect('/login?reset=1');
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      const invalid = err.details?.[0]?.field === 'token';
      return reset(res.status(400), { error: detail(err), token: invalid ? '' : token });
    }
  });
  return router;
}

/** Seguridad de la cuenta propia (2FA) y acciones del administrador sobre otras cuentas. */
export function createAccountSecurityRouter({ service, unlockAccount, findUserEmail }) {
  const uid = (req) => req.session.userId;
  const page = (req, res, extra = {}) =>
    res.render('pages/account/security', {
      title: 'Seguridad de la cuenta',
      status: service.status(uid(req)),
      setup: null,
      codes: null,
      error: null,
      notice: null,
      ...extra,
    });

  const router = Router();
  router.get('/account/security', (req, res) => {
    const status = service.status(uid(req));
    page(req, res, {
      setup: status.pending ? service.pendingSetup(uid(req)) : null,
      notice: req.query.disabled === '1' ? 'Se desactivó la autenticación en dos pasos.' : null,
    });
  });
  router.post('/account/security/setup', (req, res) => {
    try {
      page(req, res, { setup: service.beginSetup(uid(req)) });
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      page(req, res.status(err.status), { error: detail(err) });
    }
  });
  router.post('/account/security/enable', (req, res) => {
    try {
      const codes = service.enable(uid(req), req.body?.code, req.ip);
      page(req, res, { codes, notice: 'Dos pasos activado. Guarda tus códigos de recuperación.' });
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      page(req, res.status(err.status), {
        setup: service.pendingSetup(uid(req)),
        error: detail(err),
      });
    }
  });
  router.post('/account/security/disable', async (req, res) => {
    try {
      await service.disable(uid(req), req.body?.password, req.body?.code, req.ip);
      res.redirect('/account/security?disabled=1');
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      page(req, res.status(err.status), { error: detail(err) });
    }
  });
  router.post('/account/security/codes', (req, res) => {
    try {
      page(req, res, {
        codes: service.regenerateCodes(uid(req), req.body?.code, req.ip),
        notice: 'Códigos nuevos generados; los anteriores ya no sirven.',
      });
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      page(req, res.status(err.status), { error: detail(err) });
    }
  });

  const admin = requireRole('admin');
  router.post('/admin/users/:id/reset-2fa', admin, (req, res) => {
    const id = parseId(req.params.id);
    service.adminReset(uid(req), id, req.ip);
    res.redirect(`/admin/users/${id}?done=reset-2fa`);
  });
  router.post('/admin/users/:id/unlock', admin, (req, res) => {
    const id = parseId(req.params.id);
    const email = findUserEmail(id);
    if (!email) throw AppError.notFound('Usuario no encontrado');
    unlockAccount(email);
    req.app.locals.securityEvents?.record('account_unlocked', {
      userId: id,
      email,
      ip: req.ip,
      detail: `administrador ${uid(req)}`,
    });
    res.redirect(`/admin/users/${id}?done=unlock`);
  });
  return router;
}
