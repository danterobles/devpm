import { AppError } from '../lib/AppError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa CSRF complementaria a SameSite=Strict: en métodos que modifican estado,
 * el host de `Origin` (o, en su defecto, de `Referer`) debe coincidir con el `Host` de la petición.
 * Sin ninguna de las dos cabeceras (clientes que no son navegador) la petición pasa, salvo que el
 * navegador declare `Sec-Fetch-Site: cross-site`.
 */
export function verifyOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // Los navegadores declaran el origen de la petición: «cross-site» nunca es legítimo aquí.
  if (req.get('sec-fetch-site') === 'cross-site') {
    return next(AppError.forbidden('Origen de la petición no permitido'));
  }
  const source = req.get('origin') ?? req.get('referer');
  if (source === undefined) return next();
  let host = null;
  try {
    host = new URL(source).host;
  } catch {
    // Origin "null" o valor mal formado: se rechaza abajo.
  }
  if (host !== null && host === req.get('host')) return next();
  return next(AppError.forbidden('Origen de la petición no permitido'));
}
