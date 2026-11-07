import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

export const SCOPES = ['projects', 'tasks', 'time'];
export const MAX_PER_USER = 20;

const text = z.string().trim().max(100);
const pick = (values) => z.enum(['all', ...values]);
const id = z.coerce.number().int().positive();
const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');

/**
 * Filtros permitidos por ámbito (orden canónico). El valor «all» es el predeterminado y no se guarda.
 * Son los mismos nombres y valores que aceptan las pantallas a las que se aplican.
 */
export const FILTERS = {
  projects: {
    q: text,
    status: pick(['planning', 'active', 'on_hold', 'completed', 'cancelled']),
    priority: pick(['low', 'medium', 'high', 'critical']),
    clientId: id,
    managerId: id,
  },
  tasks: {
    q: text,
    type: pick(['feature', 'bug', 'chore', 'spike']),
    priority: pick(['low', 'medium', 'high', 'critical']),
    assigneeId: id,
  },
  time: { from: date, to: date, status: pick(['draft', 'submitted', 'approved', 'rejected']) },
};

/**
 * Convierte filtros crudos (objeto o cadena de consulta) en la cadena canónica del ámbito: solo las
 * claves permitidas, en orden fijo, sin vacíos ni «all». Devuelve `{ query, errors }`.
 */
export function canonicalQuery(scope, raw) {
  const source =
    typeof raw === 'string' ? Object.fromEntries(new URLSearchParams(raw)) : (raw ?? {});
  const params = new URLSearchParams();
  const errors = [];
  for (const [key, schema] of Object.entries(FILTERS[scope])) {
    const value = typeof source[key] === 'string' ? source[key].trim() : '';
    if (value === '' || value === 'all') continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) params.set(key, String(parsed.data));
    else errors.push({ field: key, message: parsed.error.issues[0].message });
  }
  return { query: params.toString(), errors };
}

export const createSchema = z.strictObject({
  scope: z.enum(SCOPES, { error: 'Ámbito inválido' }),
  name: z
    .string()
    .trim()
    .min(1, 'Escribe un nombre')
    .max(60, 'El nombre no puede exceder 60 caracteres'),
  query: z.union([z.string().max(1000), z.record(z.string(), z.string())]).default(''),
});

export const idSchema = z.coerce.number().int().positive();
export const scopeQuerySchema = z.object({ scope: z.enum(SCOPES).optional() });
