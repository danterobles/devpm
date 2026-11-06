import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

export const TIME_OFF_TYPES = ['vacation', 'sick', 'personal', 'holiday'];

const type = z.enum(TIME_OFF_TYPES, { error: 'Tipo de ausencia inválido' });
const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const notes = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const endAfterStart = (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate;
const ORDER = { message: 'La fecha final no puede ser anterior a la inicial', path: ['endDate'] };

export const createTimeOffSchema = z
  .strictObject({ type, startDate: date, endDate: date, notes })
  .refine(endAfterStart, ORDER);

export const updateTimeOffSchema = z
  .strictObject({ type, startDate: date, endDate: date, notes })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' })
  .refine(endAfterStart, ORDER);

export const timeOffQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
});

export const idSchema = z.coerce.number().int().positive();
