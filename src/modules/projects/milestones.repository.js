const COLUMNS = {
  name: 'name',
  description: 'description',
  dueDate: 'due_date',
  status: 'status',
  completedAt: 'completed_at',
};

export function createMilestonesRepository(db) {
  const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?');
  const byId = db.prepare('SELECT * FROM milestones WHERE id = ? AND project_id = ?');
  const list = db.prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date, id');

  return {
    projectExists: (id) => Boolean(projectExists.get(id)),
    findById: (projectId, id) => byId.get(id, projectId),
    listByProject: (projectId) => list.all(projectId),

    insert(projectId, { name, description = null, dueDate }) {
      const info = db
        .prepare(
          `INSERT INTO milestones (project_id, name, description, due_date)
           VALUES (@projectId, @name, @description, @dueDate)`,
        )
        .run({ projectId, name, description, dueDate });
      return Number(info.lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, fields[k]])) };
      db.prepare(`UPDATE milestones SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },

    clearCompletedAt: (id) =>
      db.prepare('UPDATE milestones SET completed_at = NULL WHERE id = ?').run(id),
    remove: (id) => db.prepare('DELETE FROM milestones WHERE id = ?').run(id).changes,
  };
}
