import { AppError } from '../lib/AppError.js';

export function notFound(req, _res, next) {
  next(AppError.notFound(`Ruta no encontrada: ${req.method} ${req.path}`));
}
