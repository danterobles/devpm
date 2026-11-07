import { existsSync, readdirSync, statSync } from 'node:fs';
import { BACKUP_PATTERN } from '../../db/backup.js';

const BACKUP_MAX_AGE_HOURS = 48;
const SLOW_P95_MS = 300;

/**
 * Estado del sistema para el administrador (PRD §5.19): solo lectura, sin servicios externos.
 * Cada comprobación que falla se convierte en una alerta visible.
 */
export function createStatusService({
  db,
  config,
  metrics,
  version,
  mailerEnabled = () => false,
  sseClients = () => 0,
  remindersLastRun = () => null,
  now = () => new Date(),
}) {
  function database() {
    try {
      db.prepare('SELECT 1').get();
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const migrations = db
      .prepare('SELECT count(*) AS n, max(version) AS last FROM schema_migrations')
      .get();
    const count = (table) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
    let bytes = null;
    try {
      if (config.databasePath !== ':memory:') bytes = statSync(config.databasePath).size;
    } catch {
      bytes = null;
    }
    return {
      ok: true,
      bytes,
      migrations: migrations.n,
      lastMigration: migrations.last,
      counts: {
        users: count('users'),
        projects: count('projects'),
        tasks: count('tasks'),
        timeEntries: count('time_entries'),
        notifications: count('notifications'),
      },
    };
  }

  function lastBackup() {
    try {
      if (!existsSync(config.backupDir)) return null;
      let newest = null;
      for (const name of readdirSync(config.backupDir)) {
        const m = BACKUP_PATTERN.exec(name);
        if (!m) continue;
        const at = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]));
        if (!newest || at > newest.at) newest = { name, at };
      }
      return newest && { name: newest.name, at: newest.at.toISOString() };
    } catch {
      return null;
    }
  }

  return {
    snapshot() {
      const db_ = database();
      const requests = metrics.snapshot();
      const backup = lastBackup();
      const attachments = db_.ok
        ? db
            .prepare(
              'SELECT count(*) AS n, coalesce(sum(size_bytes), 0) AS bytes FROM task_attachments',
            )
            .get()
        : { n: 0, bytes: 0 };
      const reminders = remindersLastRun();
      const alerts = [];
      if (!db_.ok)
        alerts.push({ level: 'error', message: `La base de datos no responde: ${db_.error}` });
      if (!backup) {
        alerts.push({
          level: 'warn',
          message: 'No hay respaldos: programa `npm run db:backup` (README, «Respaldos»).',
        });
      } else if (now() - new Date(backup.at) > BACKUP_MAX_AGE_HOURS * 3600 * 1000) {
        alerts.push({
          level: 'warn',
          message: `El último respaldo tiene más de ${BACKUP_MAX_AGE_HOURS} horas (${backup.at.slice(0, 16).replace('T', ' ')} UTC).`,
        });
      }
      if (requests.recentServerErrors > 0) {
        alerts.push({
          level: 'error',
          message: `${requests.recentServerErrors} error(es) del servidor en los últimos ${requests.windowMinutes} minutos.`,
        });
      }
      if (requests.p95Ms !== null && requests.p95Ms > SLOW_P95_MS) {
        alerts.push({
          level: 'warn',
          message: `Latencia alta: p95 de ${requests.p95Ms} ms (objetivo < ${SLOW_P95_MS} ms).`,
        });
      }
      return {
        generatedAt: now().toISOString(),
        version,
        node: process.version,
        environment: config.env,
        database: db_,
        requests,
        liveConnections: sseClients(),
        backup: { last: backup, directory: config.backupDir, maxAgeHours: BACKUP_MAX_AGE_HOURS },
        attachments: { count: attachments.n, bytes: attachments.bytes },
        mail: { configured: Boolean(mailerEnabled()) },
        reminders,
        alerts,
        ok: alerts.every((a) => a.level !== 'error'),
      };
    },
  };
}
