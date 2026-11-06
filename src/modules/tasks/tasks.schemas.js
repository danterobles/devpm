import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

export const TYPES = ['feature', 'bug', 'chore', 'spike'];
export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'];
export const PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const POINTS = [0, 1, 2, 3, 5, 8, 13, 21];

const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const id = (message) => z.number({ error: message }).int().positive(message);

const fields = {
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  description: z
    .string()
    .trim()
    .max(4000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  type: z.enum(TYPES, { error: 'Tipo inválido' }),
  priority: z.enum(PRIORITIES, { error: 'Prioridad inválida' }),
  storyPoints: z
    .number({ error: 'Puntos inválidos' })
    .refine((v) => POINTS.includes(v), 'Puntos inválidos (0, 1, 2, 3, 5, 8, 13 o 21)')
    .nullable()
    .optional(),
  estimatedMinutes: z
    .number({ error: 'Estimación inválida' })
    .int('Debe ser entero (minutos)')
    .min(0, 'No puede ser negativa')
    .nullable()
    .optional(),
  startDate: date.nullable().optional(),
  dueDate: date.nullable().optional(),
  assigneeId: id('Responsable inválido').nullable().optional(),
  sprintId: id('Sprint inválido').nullable().optional(),
  milestoneId: id('Hito inválido').nullable().optional(),
};

const ORDER = {
  message: 'La fecha de fin no puede ser anterior a la de inicio',
  path: ['dueDate'],
};
const datesOk = (v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate;

export const createTaskSchema = z
  .strictObject({
    ...fields,
    type: fields.type.default('feature'),
    priority: fields.priority.default('medium'),
    parentTaskId: id('Tarea padre inválida').nullable().optional(),
  })
  .refine(datesOk, ORDER);

// parentTaskId y status no se editan por aquí (el estado tiene su propio endpoint).
export const updateTaskSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' })
  .refine(datesOk, ORDER);

export const changeStatusSchema = z.strictObject({
  status: z.enum(STATUSES, { error: 'Estado inválido' }),
});

export const idSchema = z.coerce.number().int().positive();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', ...STATUSES]).default('all'),
  type: z.enum(['all', ...TYPES]).default('all'),
  priority: z.enum(['all', ...PRIORITIES]).default('all'),
  sprintId: z.coerce.number().int().positive().optional(),
  assigneeId: z.coerce.number().int().positive().optional(),
  backlog: z.enum(['true', 'false']).optional(),
});
