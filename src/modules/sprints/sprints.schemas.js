import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const goal = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const fields = {
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(100),
  goal,
  startDate: date,
  endDate: date,
};
const ORDER = { message: 'La fecha final no puede ser anterior a la inicial', path: ['endDate'] };
const endAfterStart = (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

export const createSprintSchema = z.strictObject(fields).refine(endAfterStart, ORDER);

export const updateSprintSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' })
  .refine(endAfterStart, ORDER);

export const closeSprintSchema = z.strictObject({
  moveTo: z.number().int().positive().nullable().optional(),
});

export const idSchema = z.coerce.number().int().positive();
