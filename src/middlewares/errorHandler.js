import { AppError } from '../lib/AppError.js';

function fromSqlite(err) {
  if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    return AppError.conflict('La operación viola una restricción de datos');
  }
  return null;
}

/** Manejador central: JSON en /api/*, vista HTML en el resto. */
export function createErrorHandler(logger) {
  return function errorHandler(err, req, res, _next) {
    const appErr = err instanceof AppError ? err : fromSqlite(err);
    const status = appErr?.status ?? err.status ?? 500;
    const isServerError = status >= 500;

    if (isServerError) logger.error({ err, path: req.path }, 'Error no controlado');

    const code = appErr?.code ?? (isServerError ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
    const message = isServerError ? 'Error interno del servidor' : (appErr?.message ?? err.message);

    if (res.headersSent) return;
    res.status(status);

    if (req.path.startsWith('/api/') || req.path === '/health') {
      return res.json({ error: { code, message, details: appErr?.details } });
    }
    return res.render('pages/error', { title: `Error ${status}`, status, message });
  };
}
