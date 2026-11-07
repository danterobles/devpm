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
  BACKUP_DIR: z.string().min(1).default('data/backups'),
  // Adjuntos de tareas (PRD §5.16): carpeta fuera de public/ y tamaño máximo (1 a 5 MB).
  UPLOAD_DIR: z.string().min(1).default('data/uploads'),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(5).default(5),
  // Notificaciones por correo (opcionales): sin SMTP_HOST solo hay avisos dentro de la aplicación.
  APP_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(3).default('DevPM <no-reply@localhost>'),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
  if (c.NODE_ENV === 'production' && c.SESSION_SECRET.startsWith('cambia-este-secreto')) {
    throw new Error(
      'Configuración inválida:\n  - SESSION_SECRET: en producción no se permite el valor de ejemplo de .env.example',
    );
  }
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
    backupDir: c.BACKUP_DIR,
    uploadDir: c.UPLOAD_DIR,
    uploadMaxBytes: c.UPLOAD_MAX_MB * 1024 * 1024,
    appUrl: (c.APP_URL ?? `http://localhost:${c.PORT}`).replace(/\/+$/, ''),
    smtp: {
      host: c.SMTP_HOST || null,
      port: c.SMTP_PORT,
      user: c.SMTP_USER || null,
      pass: c.SMTP_PASS || null,
      from: c.SMTP_FROM,
      secure: c.SMTP_SECURE,
    },
  });
}
