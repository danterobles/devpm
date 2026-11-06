import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

export const STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const fields = {
  projectId: z.number({ error: 'Proyecto inválido' }).int().positive('Proyecto inválido'),
  taskId: z
    .number({ error: 'Tarea inválida' })
    .int()
    .positive('Tarea inválida')
    .nullable()
    .optional(),
  workDate: date,
  minutes: z
    .number({ error: 'La duración debe ser un número de minutos' })
    .int('La duración debe ser entera (minutos)')
    .min(1, 'La duración mínima es 1 minuto')
    .max(1440, 'Un registro no puede exceder 24 horas'),
  description: z.string().trim().min(1, 'La descripción es obligatoria').max(500),
};

// El estado, el miembro y la bandera facturable no se envían: los define el sistema.
export const createEntrySchema = z.strictObject(fields);

export const updateEntrySchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' });

export const idSchema = z.coerce.number().int().positive();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  from: date.optional(),
  to: date.optional(),
  projectId: z.coerce.number().int().positive().optional(),
  memberId: z.coerce.number().int().positive().optional(),
  clientId: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', ...STATUSES]).default('all'),
});

export const sheetQuerySchema = z.object({
  week: date.optional(),
  memberId: z.coerce.number().int().positive().optional(),
});
