import { AppError } from '../lib/AppError.js';

/**
 * Exige que el rol de la sesión esté entre los permitidos (lista explícita, sin herencia).
 * Sin sesión responde 401; con rol insuficiente, 403.
 * @param {...('admin'|'pm'|'developer'|'viewer')} roles
 */
export function requireRole(...roles) {
  if (roles.length === 0) throw new Error('requireRole requiere al menos un rol');
  return function requireRoleMiddleware(req, _res, next) {
    if (!req.session?.userId) return next(AppError.unauthenticated());
    if (!roles.includes(req.session.role)) return next(AppError.forbidden());
    return next();
  };
}
