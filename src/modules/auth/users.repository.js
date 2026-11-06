const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const COLUMNS = `id, email, full_name, role, team_member_id, is_active,
                 last_login_at, created_at, updated_at`;

export function createUsersRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`);
  const byEmail = db.prepare('SELECT id FROM users WHERE email = ?');
  const byTeamMember = db.prepare('SELECT id FROM users WHERE team_member_id = ?');
  const teamMemberExists = db.prepare('SELECT 1 FROM team_members WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO users (email, password_hash, full_name, role, team_member_id)
     VALUES (@email, @passwordHash, @fullName, @role, @teamMemberId)`,
  );

  return {
    findById: (id) => byId.get(id),
    findIdByEmail: (email) => byEmail.get(email)?.id ?? null,
    findIdByTeamMember: (teamMemberId) => byTeamMember.get(teamMemberId)?.id ?? null,
    teamMemberExists: (id) => Boolean(teamMemberExists.get(id)),

    list({ q, status, page, pageSize }) {
      const where = [];
      const params = {};
      if (q) {
        where.push("(email LIKE @q ESCAPE '\\' OR full_name LIKE @q ESCAPE '\\')");
        params.q = `%${escapeLike(q)}%`;
      }
      if (status !== 'all') {
        where.push('is_active = @active');
        params.active = status === 'active' ? 1 : 0;
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT count(*) FROM users ${clause}`).pluck().get(params);
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM users ${clause}
            ORDER BY full_name COLLATE NOCASE, id LIMIT @limit OFFSET @offset`,
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },

    insert: (u) => Number(insert.run(u).lastInsertRowid),

    /** Actualiza solo las columnas presentes en `fields` (claves fijas del código, nunca del usuario). */
    update(id, fields) {
      const allowed = {
        email: 'email',
        fullName: 'full_name',
        role: 'role',
        passwordHash: 'password_hash',
        isActive: 'is_active',
        teamMemberId: 'team_member_id',
      };
      const sets = [];
      const params = { id };
      for (const [key, column] of Object.entries(allowed)) {
        if (fields[key] !== undefined) {
          sets.push(`${column} = @${key}`);
          params[key] = typeof fields[key] === 'boolean' ? Number(fields[key]) : fields[key];
        }
      }
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },
  };
}
