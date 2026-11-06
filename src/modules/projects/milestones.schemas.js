import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

export const MILESTONE_STATUSES = ['pending', 'completed', 'missed'];

const name = z.string().trim().min(1, 'El nombre del hito es obligatorio').max(150);
const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const description = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const status = z.enum(MILESTONE_STATUSES, { error: 'Estado de hito inválido' });

export const createMilestoneSchema = z.strictObject({ name, description, dueDate: date });

export const updateMilestoneSchema = z
  .strictObject({ name, description, dueDate: date, status })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' });

export const milestoneStatusSchema = z.strictObject({ status });

export const milestoneIdSchema = z.coerce.number().int().positive();
