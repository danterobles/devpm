import { AppError } from '../lib/AppError.js';

/** Exige sesión iniciada: 401 JSON en /api/*, redirección a /login en vistas HTML. */
export function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  if (req.originalUrl.startsWith('/api/')) return next(AppError.unauthenticated());
  return res.redirect('/login');
}
