import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

export const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
export const PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const METHODOLOGIES = ['scrum', 'kanban', 'waterfall'];

const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const description = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const nullableInt = (message) => z.number().int(message).min(0, 'No puede ser negativo');

const fields = {
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(150),
  description,
  clientId: z.number().int().positive('Cliente inválido'),
  managerId: z.number().int().positive('Líder inválido').nullable().optional(),
  priority: z.enum(PRIORITIES, { error: 'Prioridad inválida' }),
  methodology: z.enum(METHODOLOGIES, { error: 'Metodología inválida' }),
  startDate: date,
  endDate: date,
  budgetMinutes: nullableInt('Debe ser entero (minutos)'),
  budgetCents: nullableInt('Debe ser entero (centavos)').nullable().optional(),
  isBillable: z.boolean().optional(),
};

const ORDER = { message: 'La fecha final no puede ser anterior a la inicial', path: ['endDate'] };
const endAfterStart = (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

export const createProjectSchema = z
  .strictObject({
    ...fields,
    priority: fields.priority.default('medium'),
    methodology: fields.methodology.default('scrum'),
    budgetMinutes: fields.budgetMinutes.default(0),
  })
  .refine(endAfterStart, ORDER);

// El código y el estado no se editan aquí (el estado cambia con su propia transición).
export const updateProjectSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' })
  .refine(endAfterStart, ORDER);

export const idParamSchema = z.coerce.number().int().positive();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', ...STATUSES]).default('all'),
  priority: z.enum(['all', ...PRIORITIES]).default('all'),
  clientId: z.coerce.number().int().positive().optional(),
  managerId: z.coerce.number().int().positive().optional(),
});
