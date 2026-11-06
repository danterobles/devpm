import { AppError } from '../lib/AppError.js';

/**
 * Valida `req.body` con un esquema Zod; el resultado parseado queda en `req.validated`.
 * @param {import('zod').ZodType} schema
 */
export function validateBody(schema) {
  return function validateBodyMiddleware(req, _res, next) {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(AppError.validation('Datos inválidos', details));
    }
    req.validated = parsed.data;
    return next();
  };
}
