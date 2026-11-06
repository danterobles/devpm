const SELECT = `
  SELECT s.*,
         (SELECT count(*) FROM tasks t WHERE t.sprint_id = s.id) AS task_count,
         (SELECT COALESCE(SUM(t.story_points), 0) FROM tasks t WHERE t.sprint_id = s.id) AS total_points,
         (SELECT COALESCE(SUM(t.story_points), 0) FROM tasks t
           WHERE t.sprint_id = s.id AND t.status = 'done') AS done_points
    FROM sprints s`;

const COLUMNS = { name: 'name', goal: 'goal', startDate: 'start_date', endDate: 'end_date' };

export function createSprintsRepository(db) {
  const byId = db.prepare(`${SELECT} WHERE s.id = ?`);
  const list = db.prepare(`${SELECT} WHERE s.project_id = ? ORDER BY s.start_date, s.id`);
  const project = db.prepare(
    'SELECT id, code, name, start_date, end_date FROM projects WHERE id = ?',
  );
  const overlapping = db.prepare(
    `SELECT id FROM sprints
      WHERE project_id = @projectId AND id != @exceptId
        AND start_date <= @endDate AND end_date >= @startDate LIMIT 1`,
  );
  const activeOf = db.prepare("SELECT id FROM sprints WHERE project_id = ? AND status = 'active'");
  const points = db.prepare(
    `SELECT COALESCE(SUM(story_points), 0) FROM tasks
      WHERE sprint_id = ? AND (@onlyDone = 0 OR status = 'done')`,
  );
  const unfinished = db.prepare(
    "SELECT id, status FROM tasks WHERE sprint_id = ? AND status != 'done' ORDER BY sort_order, id",
  );
  const taskCount = db.prepare('SELECT count(*) FROM tasks WHERE sprint_id = ?');

  return {
    findProject: (id) => project.get(id),
    findById: (id) => byId.get(id),
    listByProject: (projectId) => list.all(projectId),
    hasOverlap: (projectId, startDate, endDate, exceptId = 0) =>
      Boolean(overlapping.get({ projectId, startDate, endDate, exceptId })),
    findActiveId: (projectId) => activeOf.get(projectId)?.id ?? null,
    sumPoints: (sprintId, onlyDone) => points.pluck().get(sprintId, { onlyDone: onlyDone ? 1 : 0 }),
    unfinishedTasks: (sprintId) => unfinished.all(sprintId),
    countTasks: (sprintId) => taskCount.pluck().get(sprintId),

    insert(projectId, f) {
      const info = db
        .prepare(
          `INSERT INTO sprints (project_id, name, goal, start_date, end_date)
           VALUES (@projectId, @name, @goal, @startDate, @endDate)`,
        )
        .run({ projectId, goal: null, ...f });
      return Number(info.lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, fields[k]])) };
      db.prepare(`UPDATE sprints SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },

    setStatus(id, status, extra = {}) {
      db.prepare(
        `UPDATE sprints SET status = @status,
                committed_points = coalesce(@committed, committed_points),
                completed_points = coalesce(@completed, completed_points),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = @id`,
      ).run({
        id,
        status,
        committed: extra.committedPoints ?? null,
        completed: extra.completedPoints ?? null,
      });
    },

    moveTaskToSprint: (taskId, sprintId) =>
      db
        .prepare(
          "UPDATE tasks SET sprint_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        )
        .run(sprintId, taskId),
    releaseTaskToBacklog: (taskId) =>
      db
        .prepare(
          `UPDATE tasks SET sprint_id = NULL, status = 'backlog',
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        )
        .run(taskId),
    remove: (id) => db.prepare('DELETE FROM sprints WHERE id = ?').run(id).changes,
  };
}
