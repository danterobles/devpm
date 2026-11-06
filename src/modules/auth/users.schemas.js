import { z } from 'zod';

export const ROLES = ['admin', 'pm', 'developer', 'viewer'];

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(200, 'La contraseña no puede exceder 200 caracteres');

// Los formularios HTML envían '' para campos vacíos.
const emptyToNull = (v) => (v === '' ? null : v);
const emptyToUndefined = (v) => (v === '' ? undefined : v);

const teamMemberId = z.preprocess(
  emptyToNull,
  z.coerce.number().int().positive('Miembro del equipo inválido').nullable(),
);

const email = z.string().trim().toLowerCase().email('Correo inválido').max(254);
const fullName = z.string().trim().min(1, 'El nombre es obligatorio').max(120);
const role = z.enum(ROLES, { error: 'Rol inválido' });

export const createUserSchema = z.object({
  email,
  fullName,
  role,
  password: passwordSchema,
  teamMemberId: teamMemberId.optional(),
});

export const updateUserSchema = z
  .object({
    email: email.optional(),
    fullName: fullName.optional(),
    role: role.optional(),
    password: z.preprocess(emptyToUndefined, passwordSchema.optional()),
    isActive: z.boolean().optional(),
    teamMemberId: teamMemberId.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios que aplicar' });

export const idParamSchema = z.coerce.number().int().positive();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});
