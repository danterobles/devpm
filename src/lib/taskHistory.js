/**
 * Registra un cambio de estado de tarea en `task_status_history` (RF-62).
 * Debe llamarse dentro de la misma transacción del cambio.
 * @param {object} db
 * @param {{taskId: number, from: string|null, to: string, userId?: number|null}} entry
 */
export function recordTaskStatus(db, { taskId, from, to, userId = null }) {
  db.prepare(
    'INSERT INTO task_status_history (task_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)',
  ).run(taskId, from, to, userId);
}
