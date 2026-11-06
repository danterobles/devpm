import { z } from 'zod';

const required = (max) => z.string().trim().min(1, 'Campo obligatorio').max(max);
// Opcional: '' se normaliza a null; null limpia el valor en ediciones.
const optional = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const optionalEmail = z
  .union([z.literal(''), z.string().trim().toLowerCase().email('Correo inválido').max(254)])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const common = {
  name: required(120),
  contactName: optional(120),
  contactEmail: optionalEmail,
  contactPhone: optional(40),
  notes: optional(2000),
};
const internalFields = { department: required(120), costCenter: optional(60) };
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Moneda inválida (3 letras mayúsculas, p. ej. MXN)');
const externalFields = {
  legalName: required(200),
  taxId: optional(40),
  hourlyRateCents: z.number().int('Debe ser entero (centavos)').min(0, 'No puede ser negativa'),
  address: optional(300),
};

export const createClientSchema = z.discriminatedUnion(
  'type',
  [
    z.strictObject({ type: z.literal('internal'), ...common, ...internalFields }),
    z.strictObject({
      type: z.literal('external'),
      ...common,
      ...externalFields,
      currency: currency.default('MXN'),
    }),
  ],
  { error: 'Tipo de cliente inválido' },
);

const nonEmpty = (v) => Object.keys(v).length > 0;
const NO_CHANGES = { message: 'No hay cambios que aplicar' };

/** Esquemas de edición por tipo: el `type` no es editable. */
export const updateClientSchemas = {
  internal: z
    .strictObject({ ...common, ...internalFields, isActive: z.boolean() })
    .partial()
    .refine(nonEmpty, NO_CHANGES),
  external: z
    .strictObject({ ...common, ...externalFields, currency, isActive: z.boolean() })
    .partial()
    .refine(nonEmpty, NO_CHANGES),
};

export const idParamSchema = z.coerce.number().int().positive();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  type: z.enum(['all', 'internal', 'external']).default('all'),
});
