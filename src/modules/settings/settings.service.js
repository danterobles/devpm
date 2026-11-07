import { diff, recordAudit } from '../../lib/audit.js';
import { DEFAULT_THRESHOLDS } from '../dashboard/thresholds.js';
import { thresholdsSchema } from './thresholds.schemas.js';

const KEY = 'kpi.thresholds';

/**
 * Configuración de la aplicación guardada en `settings` (clave/valor JSON). Hoy: los umbrales de
 * semáforo de los KPIs (RF-93). Si lo guardado falta, está corrupto o es inválido se usan los
 * valores de fábrica, así el tablero nunca se rompe por la configuración.
 */
export function createSettingsService({ db, events = null }) {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?').pluck();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const remove = db.prepare('DELETE FROM settings WHERE key = ?');

  /** Valores guardados completados con los de fábrica (por KPI); `null` si no hay o no son válidos. */
  function stored() {
    const raw = read.get(KEY);
    if (raw === undefined) return null;
    try {
      const merged = { ...structuredClone(DEFAULT_THRESHOLDS), ...JSON.parse(raw) };
      const parsed = thresholdsSchema.safeParse(merged);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  const service = {
    /** Umbrales vigentes (para el tablero). */
    getThresholds: () => stored() ?? structuredClone(DEFAULT_THRESHOLDS),

    /** Umbrales y bandera de si son los de fábrica (para la API y la página de configuración). */
    describe() {
      const saved = stored();
      return {
        thresholds: saved ?? structuredClone(DEFAULT_THRESHOLDS),
        isDefault: saved === null,
      };
    },

    update(actorId, input) {
      const before = service.getThresholds();
      db.transaction(() => {
        upsert.run(KEY, JSON.stringify(input));
        const changes = diff(
          Object.fromEntries(
            Object.entries(before).map(([k, v]) => [`${KEY}.${k}`, JSON.stringify(v)]),
          ),
          Object.fromEntries(
            Object.entries(input).map(([k, v]) => [`${KEY}.${k}`, JSON.stringify(v)]),
          ),
        );
        if (Object.keys(changes).length > 0) {
          const readable = Object.fromEntries(
            Object.entries(changes).map(([k, [a, b]]) => [k, [JSON.parse(a), JSON.parse(b)]]),
          );
          recordAudit(db, {
            userId: actorId,
            entity: 'settings',
            entityId: 1,
            action: 'update',
            changes: readable,
          });
        }
      })();
      const changed = JSON.stringify(before) !== JSON.stringify(input);
      if (changed) events?.emit('settings.updated', { key: KEY });
      return service.describe();
    },

    /** Vuelve a los valores del PRD. */
    reset(actorId) {
      const existed = read.get(KEY) !== undefined;
      if (existed) {
        db.transaction(() => {
          remove.run(KEY);
          recordAudit(db, {
            userId: actorId,
            entity: 'settings',
            entityId: 1,
            action: 'update',
            changes: { [KEY]: ['personalizado', 'valores del PRD'] },
          });
        })();
        events?.emit('settings.updated', { key: KEY });
      }
      return service.describe();
    },
  };
  return service;
}
