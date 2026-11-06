import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const fields = {
  teamMemberId: z.number({ error: 'Miembro inválido' }).int().positive('Miembro inválido'),
  projectRole: z.string().trim().min(1, 'El rol en el proyecto es obligatorio').max(80),
  allocationPercent: z
    .number({ error: 'Dedicación inválida' })
    .int('La dedicación debe ser un entero')
    .min(1, 'La dedicación mínima es 1 %')
    .max(100, 'La dedicación máxima es 100 %'),
  startDate: date,
  endDate: date,
};

const ORDER = { message: 'La fecha final no puede ser anterior a la inicial', path: ['endDate'] };
const endAfterStart = (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

export const createAssignmentSchema = z.strictObject(fields).refine(endAfterStart, ORDER);

// El miembro no se cambia: para otro miembro se crea otra asignación.
const editable = { ...fields };
delete editable.teamMemberId;
export const updateAssignmentSchema = z
  .strictObject(editable)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' })
  .refine(endAfterStart, ORDER);

export const idSchema = z.coerce.number().int().positive();
