const SELECT = `
  SELECT e.*, trim(m.first_name || ' ' || m.last_name) AS member_name,
         p.code AS project_code, p.name AS project_name, p.manager_id AS project_manager_id,
         t.title AS task_title
    FROM time_entries e
    JOIN team_members m ON m.id = e.team_member_id
    JOIN projects p ON p.id = e.project_id
    LEFT JOIN tasks t ON t.id = e.task_id`;

// camelCase (API) → columna. Lista cerrada: nunca se interpolan claves del usuario.
const COLUMNS = {
  teamMemberId: 'team_member_id',
  projectId: 'project_id',
  taskId: 'task_id',
  workDate: 'work_date',
  minutes: 'minutes',
  description: 'description',
  isBillable: 'is_billable',
  status: 'status',
};
const toDb = (v) => (typeof v === 'boolean' ? Number(v) : v);

export function createTimeEntriesRepository(db) {
  const byId = db.prepare(`${SELECT} WHERE e.id = ?`);
  const project = db.prepare('SELECT id, is_billable, manager_id FROM projects WHERE id = ?');
  const task = db.prepare('SELECT id, project_id FROM tasks WHERE id = ?');
  const assigned = db.prepare(
    `SELECT 1 FROM assignments
      WHERE project_id = ? AND team_member_id = ? AND start_date <= ? AND end_date >= ? LIMIT 1`,
  );
  const daySum = db.prepare(
    `SELECT COALESCE(SUM(minutes), 0) FROM time_entries
      WHERE team_member_id = ? AND work_date = ? AND id != ?`,
  );
  const userMember = db.prepare('SELECT team_member_id FROM users WHERE id = ?');

  /** Cláusula WHERE reutilizable por el listado y la exportación. */
  function buildWhere({ from, to, projectId, memberId, clientId, status }) {
    const where = [];
    const params = {};
    if (from) {
      where.push('e.work_date >= @from');
      params.from = from;
    }
    if (to) {
      where.push('e.work_date <= @to');
      params.to = to;
    }
    if (projectId) {
      where.push('e.project_id = @projectId');
      params.projectId = projectId;
    }
    if (memberId) {
      where.push('e.team_member_id = @memberId');
      params.memberId = memberId;
    }
    if (clientId) {
      where.push('p.client_id = @clientId');
      params.clientId = clientId;
    }
    if (status && status !== 'all') {
      where.push('e.status = @status');
      params.status = status;
    }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  return {
    findById: (id) => byId.get(id),
    findProject: (id) => project.get(id),
    findTask: (id) => task.get(id),
    hasAssignment: (projectId, memberId, date) =>
      Boolean(assigned.get(projectId, memberId, date, date)),
    minutesOnDay: (memberId, date, exceptId = 0) => daySum.pluck().get(memberId, date, exceptId),
    memberOfUser: (userId) => userMember.pluck().get(userId) ?? null,
    buildWhere,

    list(filters, { page, pageSize }) {
      const { clause, params } = buildWhere(filters);
      const total = db
        .prepare(
          `SELECT count(*) FROM time_entries e JOIN projects p ON p.id = e.project_id ${clause}`,
        )
        .pluck()
        .get(params);
      const rows = db
        .prepare(
          `${SELECT} ${clause} ORDER BY e.work_date DESC, e.id DESC LIMIT @limit OFFSET @offset`,
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },

    all(filters) {
      const { clause, params } = buildWhere(filters);
      return db.prepare(`${SELECT} ${clause} ORDER BY e.work_date, e.id`).all(params);
    },

    insert(fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sql = `INSERT INTO time_entries (${keys.map((k) => COLUMNS[k]).join(', ')})
                   VALUES (${keys.map((k) => `@${k}`).join(', ')})`;
      const params = Object.fromEntries(keys.map((k) => [k, toDb(fields[k])]));
      return Number(db.prepare(sql).run(params).lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, toDb(fields[k])])) };
      db.prepare(`UPDATE time_entries SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },

    /** Limpia el motivo de rechazo (al editar o reenviar un registro rechazado). */
    clearRejection: (id) =>
      db.prepare('UPDATE time_entries SET rejection_reason = NULL WHERE id = ?').run(id),
    remove: (id) => db.prepare('DELETE FROM time_entries WHERE id = ?').run(id).changes,
  };
}
