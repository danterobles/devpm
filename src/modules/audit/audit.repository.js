/** Consulta de solo lectura de `audit_log` (DATA §3.15). */
export function createAuditRepository(db) {
  return {
    list({ entity, action, userId, from, to, page = 1, pageSize = 50 } = {}) {
      const where = [];
      const params = {};
      const add = (sql, key, value) => {
        where.push(sql);
        params[key] = value;
      };
      if (entity) add('a.entity = @entity', 'entity', entity);
      if (action) add('a.action = @action', 'action', action);
      if (userId) add('a.user_id = @userId', 'userId', userId);
      if (from) add('a.created_at >= @from', 'from', `${from}T00:00:00.000Z`);
      if (to) add('a.created_at <= @to', 'to', `${to}T23:59:59.999Z`);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT count(*) FROM audit_log a ${clause}`).pluck().get(params);
      const rows = db
        .prepare(
          `SELECT a.*, u.full_name AS user_name FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id ${clause}
            ORDER BY a.id DESC LIMIT @limit OFFSET @offset`,
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },
    entities: () =>
      db.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity').pluck().all(),
    users: () =>
      db
        .prepare(
          'SELECT DISTINCT u.id, u.full_name FROM audit_log a JOIN users u ON u.id = a.user_id ORDER BY u.full_name',
        )
        .all(),
  };
}
