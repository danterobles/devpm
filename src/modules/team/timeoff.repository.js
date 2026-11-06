const COLUMNS = {
  type: 'type',
  startDate: 'start_date',
  endDate: 'end_date',
  notes: 'notes',
};

export function createTimeOffRepository(db) {
  const memberExists = db.prepare('SELECT 1 FROM team_members WHERE id = ?');
  const byId = db.prepare('SELECT * FROM time_off WHERE id = ? AND team_member_id = ?');
  const overlaps = db.prepare(
    `SELECT id FROM time_off
      WHERE team_member_id = @memberId AND id != @exceptId
        AND start_date <= @endDate AND end_date >= @startDate
      ORDER BY id`,
  );

  return {
    memberExists: (id) => Boolean(memberExists.get(id)),
    findById: (memberId, id) => byId.get(id, memberId),

    list(memberId, { from, to }) {
      const where = ['team_member_id = @memberId'];
      const params = { memberId };
      if (from) {
        where.push('end_date >= @from');
        params.from = from;
      }
      if (to) {
        where.push('start_date <= @to');
        params.to = to;
      }
      return db
        .prepare(
          `SELECT * FROM time_off WHERE ${where.join(' AND ')} ORDER BY start_date DESC, id DESC`,
        )
        .all(params);
    },

    overlappingIds: (memberId, startDate, endDate, exceptId = 0) =>
      overlaps.all({ memberId, startDate, endDate, exceptId }).map((r) => r.id),

    insert(memberId, f) {
      const info = db
        .prepare(
          `INSERT INTO time_off (team_member_id, type, start_date, end_date, notes)
           VALUES (@memberId, @type, @startDate, @endDate, @notes)`,
        )
        .run({ memberId, notes: null, ...f });
      return Number(info.lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, fields[k]])) };
      db.prepare(`UPDATE time_off SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },

    remove: (id) => db.prepare('DELETE FROM time_off WHERE id = ?').run(id).changes,
  };
}
