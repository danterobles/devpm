import { z } from 'zod';
import { isIsoDate } from '../../lib/dates.js';

const date = z.string().refine(isIsoDate, 'Fecha inválida (YYYY-MM-DD)');

export const rangeQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
});

export const MAX_WEEKS = 26;
export const DEFAULT_WEEKS = 8;
