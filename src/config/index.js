import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('data/devpm.db'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
  TZ_APP: z.string().default('America/Mexico_City'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(10),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
});

/** Valida variables de entorno; falla rápido con un mensaje claro. */
export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${detail}`);
  }
  const c = parsed.data;
  return Object.freeze({
    env: c.NODE_ENV,
    isProduction: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
    port: c.PORT,
    databasePath: c.DATABASE_PATH,
    sessionSecret: c.SESSION_SECRET,
    timezone: c.TZ_APP,
    logLevel: c.LOG_LEVEL,
    loginMaxAttempts: c.LOGIN_MAX_ATTEMPTS,
    backupRetentionDays: c.BACKUP_RETENTION_DAYS,
  });
}
