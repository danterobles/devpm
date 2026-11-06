import { z } from 'zod';
import { diffDays, isIsoDate } from '../../lib/dates.js';

export const MAX_RANGE_DAYS = 366;

const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');
const id = z.coerce.number().int().positive('Identificador inválido');

/** Filtros del tablero (RF-92). Todos son opcionales y se combinan con AND. */
export const filtersSchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    clientType: z.enum(['internal', 'external'], { error: 'Tipo de cliente inválido' }).optional(),
    clientId: id.optional(),
    projectId: id.optional(),
    managerId: id.optional(),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: 'La fecha final no puede ser anterior a la inicial',
    path: ['to'],
  })
  .refine((v) => !v.from || !v.to || diffDays(v.from, v.to) < MAX_RANGE_DAYS, {
    message: `El periodo no puede exceder ${MAX_RANGE_DAYS} días`,
    path: ['to'],
  });
