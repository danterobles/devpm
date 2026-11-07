import { z } from 'zod';

export const idSchema = z.coerce.number().int().positive();

export const commentSchema = z.strictObject({
  body: z
    .string()
    .trim()
    .min(1, 'Escribe un comentario')
    .max(4000, 'El comentario no puede exceder 4 000 caracteres'),
});
