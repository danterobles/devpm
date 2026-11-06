const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// camelCase (API) → columna. Lista cerrada: nunca se interpolan claves del usuario.
const COLUMNS = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  position: 'position',
  seniority: 'seniority',
  weeklyCapacityMinutes: 'weekly_capacity_minutes',
  hourlyCostCents: 'hourly_cost_cents',
  hireDate: 'hire_date',
  isActive: 'is_active',
};
const toDb = (v) => (typeof v === 'boolean' ? Number(v) : v);

export function createTeamRepository(db) {
  const byId = db.prepare('SELECT * FROM team_members WHERE id = ?');
  const byEmail = db.prepare('SELECT id FROM team_members WHERE email = ?');

  return {
    findById: (id) => byId.get(id),
    findIdByEmail: (email) => byEmail.get(email)?.id ?? null,

    list({ q, status, position, page, pageSize }) {
      const where = [];
      const params = {};
      if (q) {
        where.push(
          `(first_name LIKE @q ESCAPE '\\' OR last_name LIKE @q ESCAPE '\\' OR email LIKE @q ESCAPE '\\')`,
        );
        params.q = `%${escapeLike(q)}%`;
      }
      if (status !== 'all') {
        where.push('is_active = @active');
        params.active = status === 'active' ? 1 : 0;
      }
      if (position !== 'all') {
        where.push('position = @position');
        params.position = position;
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT count(*) FROM team_members ${clause}`).pluck().get(params);
      const rows = db
        .prepare(
          `SELECT * FROM team_members ${clause}
            ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE, id
            LIMIT @limit OFFSET @offset`,
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },

    insert(fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sql = `INSERT INTO team_members (${keys.map((k) => COLUMNS[k]).join(', ')})
                   VALUES (${keys.map((k) => `@${k}`).join(', ')})`;
      const params = Object.fromEntries(keys.map((k) => [k, toDb(fields[k])]));
      return Number(db.prepare(sql).run(params).lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, toDb(fields[k])])) };
      db.prepare(`UPDATE team_members SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },
  };
}
