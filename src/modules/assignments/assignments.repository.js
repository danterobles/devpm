const COLUMNS = {
  projectRole: 'project_role',
  allocationPercent: 'allocation_percent',
  startDate: 'start_date',
  endDate: 'end_date',
};

const SELECT = `
  SELECT a.*, trim(m.first_name || ' ' || m.last_name) AS member_name
    FROM assignments a JOIN team_members m ON m.id = a.team_member_id`;

export function createAssignmentsRepository(db) {
  const project = db.prepare('SELECT id, start_date, end_date FROM projects WHERE id = ?');
  const member = db.prepare('SELECT id, is_active FROM team_members WHERE id = ?');
  const byId = db.prepare(`${SELECT} WHERE a.id = ? AND a.project_id = ?`);
  const list = db.prepare(
    `${SELECT} WHERE a.project_id = ? ORDER BY a.start_date, member_name, a.id`,
  );
  const overlapSum = db.prepare(
    `SELECT COALESCE(SUM(allocation_percent), 0) FROM assignments
      WHERE team_member_id = @memberId AND id != @exceptId
        AND start_date <= @endDate AND end_date >= @startDate`,
  );

  return {
    findProject: (id) => project.get(id),
    findMember: (id) => member.get(id),
    findById: (projectId, id) => byId.get(id, projectId),
    listByProject: (projectId) => list.all(projectId),
    overlappingPercent: (memberId, startDate, endDate, exceptId = 0) =>
      overlapSum.pluck().get({ memberId, startDate, endDate, exceptId }),

    insert(projectId, f) {
      const info = db
        .prepare(
          `INSERT INTO assignments
             (project_id, team_member_id, project_role, allocation_percent, start_date, end_date)
           VALUES (@projectId, @teamMemberId, @projectRole, @allocationPercent, @startDate, @endDate)`,
        )
        .run({ projectId, ...f });
      return Number(info.lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, fields[k]])) };
      db.prepare(`UPDATE assignments SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },

    remove: (id) => db.prepare('DELETE FROM assignments WHERE id = ?').run(id).changes,
  };
}
