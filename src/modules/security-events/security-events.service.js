import { addDays, nowIso } from '../../lib/dates.js';

export const RETENTION_DAYS = 90;

/** Tipos de evento y su descripción para la pantalla de seguridad (PRD §5.19). */
export const EVENT_TYPES = {
  login_success: 'Inicio de sesión',
  login_failed: 'Inicio de sesión fallido',
  login_blocked: 'Acceso bloqueado por intentos',
  twofa_failed: 'Código de dos pasos incorrecto',
  recovery_code_used: 'Código de recuperación usado',
  password_reset_requested: 'Restablecimiento solicitado',
  password_reset_completed: 'Contraseña restablecida',
  password_changed: 'Contraseña cambiada',
  twofa_enabled: 'Dos pasos activado',
  twofa_disabled: 'Dos pasos desactivado',
  twofa_reset_by_admin: 'Dos pasos quitado por un administrador',
  account_unlocked: 'Cuenta desbloqueada por un administrador',
};

/**
 * Registro de eventos de seguridad. Nunca interrumpe la operación que lo origina: si falla el
 * guardado, queda en el log. También escribe cada evento en el log (`event`, sin datos secretos).
 */
export function createSecurityEventsService({ repository, logger = null }) {
  return {
    record(type, { userId = null, email = null, ip = null, detail = null } = {}) {
      try {
        repository.insert({
          type,
          userId,
          email: email ? String(email).slice(0, 254) : null,
          ip: ip ? String(ip).slice(0, 64) : null,
          detail: detail ? String(detail).slice(0, 300) : null,
        });
      } catch (err) {
        logger?.error(
          { err, event: 'security_event.failed', type },
          'No se pudo guardar el evento de seguridad',
        );
      }
    },
    list(filters) {
      const { rows, total } = repository.list(filters);
      return {
        data: rows.map((r) => ({
          id: r.id,
          type: r.type,
          label: EVENT_TYPES[r.type] ?? r.type,
          userId: r.user_id,
          userName: r.user_name,
          email: r.email,
          ip: r.ip,
          detail: r.detail,
          createdAt: r.created_at,
        })),
        meta: { page: filters?.page ?? 1, pageSize: filters?.pageSize ?? 50, total },
      };
    },
    /** Elimina los eventos con más de 90 días. */
    prune(today = nowIso().slice(0, 10)) {
      return repository.prune(`${addDays(today, -RETENTION_DAYS)}T00:00:00.000Z`);
    },
    countSince: (type, sinceIso) => repository.countSince(type, sinceIso),
  };
}
