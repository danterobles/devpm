import { z } from 'zod';

export const SKILL_CATEGORIES = ['language', 'framework', 'tool', 'soft'];

export const assignSkillSchema = z.strictObject({
  name: z.string().trim().min(1, 'El nombre de la habilidad es obligatorio').max(60),
  category: z
    .union([z.literal(''), z.enum(SKILL_CATEGORIES, { error: 'Categoría inválida' })])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  level: z.coerce
    .number({ error: 'Nivel inválido' })
    .int('El nivel debe ser entero')
    .min(1, 'El nivel mínimo es 1')
    .max(5, 'El nivel máximo es 5'),
});

export const skillIdSchema = z.coerce.number().int().positive();
