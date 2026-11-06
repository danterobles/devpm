/** Calcula {campo: [antes, después]} solo con los campos que cambiaron. */
export function diff(before = {}, after = {}) {
  const changes = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'updated_at') continue;
    if (before[key] !== after[key]) changes[key] = [before[key] ?? null, after[key] ?? null];
  }
  return changes;
}

/**
 * Registra una entrada en audit_log. Llamar dentro de la misma transacción del cambio.
 * @param {object} db
 * @param {{userId?: number|null, entity: string, entityId: number, action: string, changes?: object|null}} entry
 */
export function recordAudit(db, { userId = null, entity, entityId, action, changes = null }) {
  const info = db
    .prepare(
      'INSERT INTO audit_log (user_id, entity, entity_id, action, changes) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, entity, entityId, action, changes ? JSON.stringify(changes) : null);
  return Number(info.lastInsertRowid);
}
