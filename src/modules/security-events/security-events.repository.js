/** Acceso a datos de los eventos de seguridad (DATA §3.20). */
export function createSecurityEventsRepository(db) {
  const insert = db.prepare(
    'INSERT INTO security_events (type, user_id, email, ip, detail) VALUES (@type, @userId, @email, @ip, @detail)',
  );
  const prune = db.prepare('DELETE FROM security_events WHERE created_at < ?');
  return {
    insert: (row) => Number(insert.run(row).lastInsertRowid),
    prune: (beforeIso) => prune.run(beforeIso).changes,
    list({ type, q, from, to, page = 1, pageSize = 50 } = {}) {
      const where = [];
      const params = {};
      if (type) {
        where.push('e.type = @type');
        params.type = type;
      }
      if (q) {
        where.push("(e.email LIKE @q ESCAPE '\\' OR e.ip LIKE @q ESCAPE '\\')");
        params.q = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      }
      if (from) {
        where.push('e.created_at >= @from');
        params.from = `${from}T00:00:00.000Z`;
      }
      if (to) {
        where.push('e.created_at <= @to');
        params.to = `${to}T23:59:59.999Z`;
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db
        .prepare(`SELECT count(*) FROM security_events e ${clause}`)
        .pluck()
        .get(params);
      const rows = db
        .prepare(
          `SELECT e.*, u.full_name AS user_name FROM security_events e
             LEFT JOIN users u ON u.id = e.user_id ${clause}
            ORDER BY e.id DESC LIMIT @limit OFFSET @offset`,
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },
    countSince: (type, sinceIso) =>
      db
        .prepare('SELECT count(*) FROM security_events WHERE type = ? AND created_at >= ?')
        .pluck()
        .get(type, sinceIso),
  };
}
