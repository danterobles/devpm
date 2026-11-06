import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'El correo es obligatorio').max(254),
  password: z.string().min(1, 'La contraseña es obligatoria').max(200),
});
