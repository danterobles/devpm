const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const SELECT = `
  SELECT p.*, c.name AS client_name, c.type AS client_type,
         trim(m.first_name || ' ' || m.last_name) AS manager_name
    FROM projects p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN team_members m ON m.id = p.manager_id`;

// camelCase (API) → columna. Lista cerrada: nunca se interpolan claves del usuario.
const COLUMNS = {
  code: 'code',
  name: 'name',
  description: 'description',
  clientId: 'client_id',
  managerId: 'manager_id',
  priority: 'priority',
  methodology: 'methodology',
  startDate: 'start_date',
  endDate: 'end_date',
  budgetMinutes: 'budget_minutes',
  budgetCents: 'budget_cents',
  isBillable: 'is_billable',
};
const toDb = (v) => (typeof v === 'boolean' ? Number(v) : v);

export function createProjectsRepository(db) {
  const byId = db.prepare(`${SELECT} WHERE p.id = ?`);
  const client = db.prepare('SELECT id, type, is_active FROM clients WHERE id = ?');
  const member = db.prepare('SELECT id, is_active FROM team_members WHERE id = ?');
  const lastSeq = db.prepare(
    `SELECT max(CAST(substr(code, 10) AS INTEGER)) FROM projects WHERE code LIKE ? ESCAPE '\\'`,
  );
  const outside = db.prepare(
    `SELECT count(*) FROM assignments
      WHERE project_id = ? AND (start_date < ? OR end_date > ?)`,
  );

  return {
    findById: (id) => byId.get(id),
    findClient: (id) => client.get(id),
    findMember: (id) => member.get(id),
    nextSequence: (year) => (lastSeq.pluck().get(`PRJ-${year}-%`) ?? 0) + 1,
    countAssignmentsOutside: (id, start, end) => outside.pluck().get(id, start, end),

    options: () => ({
      clients: db
        .prepare(
          'SELECT id, name, type FROM clients WHERE is_active = 1 ORDER BY name COLLATE NOCASE',
        )
        .all(),
      members: db
        .prepare(
          `SELECT id, trim(first_name || ' ' || last_name) AS name FROM team_members
            WHERE is_active = 1 ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE`,
        )
        .all(),
    }),

    list({ q, status, priority, clientId, managerId, page, pageSize }) {
      const where = [];
      const params = {};
      if (q) {
        where.push(
          `(p.code LIKE @q ESCAPE '\\' OR p.name LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\')`,
        );
        params.q = `%${escapeLike(q)}%`;
      }
      if (status !== 'all') {
        where.push('p.status = @status');
        params.status = status;
      }
      if (priority !== 'all') {
        where.push('p.priority = @priority');
        params.priority = priority;
      }
      if (clientId) {
        where.push('p.client_id = @clientId');
        params.clientId = clientId;
      }
      if (managerId) {
        where.push('p.manager_id = @managerId');
        params.managerId = managerId;
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db
        .prepare(`SELECT count(*) FROM projects p JOIN clients c ON c.id = p.client_id ${clause}`)
        .pluck()
        .get(params);
      const rows = db
        .prepare(`${SELECT} ${clause} ORDER BY p.code DESC, p.id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },

    insert(fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sql = `INSERT INTO projects (${keys.map((k) => COLUMNS[k]).join(', ')})
                   VALUES (${keys.map((k) => `@${k}`).join(', ')})`;
      const params = Object.fromEntries(keys.map((k) => [k, toDb(fields[k])]));
      return Number(db.prepare(sql).run(params).lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, toDb(fields[k])])) };
      db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },
  };
}
