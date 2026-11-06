import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

export const POSITIONS = ['frontend', 'backend', 'fullstack', 'qa', 'devops', 'designer', 'pm'];
export const SENIORITIES = ['junior', 'mid', 'senior', 'lead'];

const name = z.string().trim().min(1, 'Campo obligatorio').max(80);
const email = z.string().trim().toLowerCase().email('Correo inválido').max(254);
const position = z.enum(POSITIONS, { error: 'Puesto inválido' });
const seniority = z.enum(SENIORITIES, { error: 'Seniority inválido' });
const capacity = z
  .number()
  .int('Debe ser entero (minutos)')
  .min(0, 'No puede ser negativa')
  .max(4800, 'Máximo 80 horas semanales');
const cost = z.number().int('Debe ser entero (centavos)').min(0, 'No puede ser negativo');
const hireDate = z
  .union([z.literal(''), z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)')])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const fields = {
  firstName: name,
  lastName: name,
  email,
  position,
  seniority,
  weeklyCapacityMinutes: capacity,
  hourlyCostCents: cost,
  hireDate,
};

export const createMemberSchema = z.strictObject({
  ...fields,
  weeklyCapacityMinutes: capacity.default(2400),
  hourlyCostCents: cost.default(0),
});

export const updateMemberSchema = z
  .strictObject({ ...fields, isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' });

export const idParamSchema = z.coerce.number().int().positive();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  position: z.enum(['all', ...POSITIONS]).default('all'),
});
