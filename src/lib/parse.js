import { AppError } from './AppError.js';

/** Valida `data` con un esquema Zod; lanza AppError.validation con el detalle por campo. */
export function parseWith(schema, data) {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw AppError.validation(
    'Datos inválidos',
    parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  );
}
