const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const SELECT = `
  SELECT t.*, trim(m.first_name || ' ' || m.last_name) AS assignee_name, s.name AS sprint_name,
         (SELECT count(*) FROM tasks c WHERE c.parent_task_id = t.id) AS subtask_count
    FROM tasks t
    LEFT JOIN team_members m ON m.id = t.assignee_id
    LEFT JOIN sprints s ON s.id = t.sprint_id`;

// camelCase (API) → columna. Lista cerrada: nunca se interpolan claves del usuario.
const COLUMNS = {
  title: 'title',
  description: 'description',
  type: 'type',
  priority: 'priority',
  storyPoints: 'story_points',
  estimatedMinutes: 'estimated_minutes',
  startDate: 'start_date',
  dueDate: 'due_date',
  assigneeId: 'assignee_id',
  sprintId: 'sprint_id',
  milestoneId: 'milestone_id',
  parentTaskId: 'parent_task_id',
  status: 'status',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  sortOrder: 'sort_order',
};

export function createTasksRepository(db) {
  const byId = db.prepare(`${SELECT} WHERE t.id = ?`);
  const project = db.prepare('SELECT id FROM projects WHERE id = ?');
  const sprint = db.prepare('SELECT id, project_id, status FROM sprints WHERE id = ?');
  const milestone = db.prepare('SELECT id, project_id FROM milestones WHERE id = ?');
  const assigned = db.prepare(
    'SELECT 1 FROM assignments WHERE project_id = ? AND team_member_id = ? LIMIT 1',
  );
  const member = db.prepare('SELECT id FROM team_members WHERE id = ?');
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) FROM tasks WHERE project_id = ?',
  );
  const subtasks = db.prepare('SELECT * FROM tasks WHERE parent_task_id = ?');
  const history = db.prepare(
    `SELECT h.id, h.from_status, h.to_status, h.changed_by, h.changed_at, u.full_name AS changed_by_name
       FROM task_status_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.task_id = ? ORDER BY h.id`,
  );
  const userMember = db.prepare('SELECT team_member_id FROM users WHERE id = ?');

  return {
    projectExists: (id) => Boolean(project.get(id)),
    findById: (id) => byId.get(id),
    findSprint: (id) => sprint.get(id),
    findMilestone: (id) => milestone.get(id),
    memberExists: (id) => Boolean(member.get(id)),
    isAssigned: (projectId, memberId) => Boolean(assigned.get(projectId, memberId)),
    nextSortOrder: (projectId) => maxOrder.pluck().get(projectId) + 1,
    subtasksOf: (id) => subtasks.all(id),
    historyOf: (id) => history.all(id),
    memberOfUser: (userId) => userMember.pluck().get(userId) ?? null,

    list({ q, status, type, priority, sprintId, assigneeId, backlog, page, pageSize }, projectId) {
      const where = ['t.project_id = @projectId'];
      const params = { projectId };
      if (q) {
        where.push(`(t.title LIKE @q ESCAPE '\\' OR t.description LIKE @q ESCAPE '\\')`);
        params.q = `%${escapeLike(q)}%`;
      }
      for (const [col, value] of [
        ['status', status],
        ['type', type],
        ['priority', priority],
      ]) {
        if (value !== 'all') {
          where.push(`t.${col} = @${col}`);
          params[col] = value;
        }
      }
      if (sprintId) {
        where.push('t.sprint_id = @sprintId');
        params.sprintId = sprintId;
      }
      if (assigneeId) {
        where.push('t.assignee_id = @assigneeId');
        params.assigneeId = assigneeId;
      }
      if (backlog === 'true') where.push('t.sprint_id IS NULL');
      const clause = `WHERE ${where.join(' AND ')}`;
      const total = db.prepare(`SELECT count(*) FROM tasks t ${clause}`).pluck().get(params);
      const rows = db
        .prepare(`${SELECT} ${clause} ORDER BY t.sort_order, t.id LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },

    insert(projectId, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sql = `INSERT INTO tasks (project_id, ${keys.map((k) => COLUMNS[k]).join(', ')})
                   VALUES (@projectId, ${keys.map((k) => `@${k}`).join(', ')})`;
      const params = { projectId, ...Object.fromEntries(keys.map((k) => [k, fields[k]])) };
      return Number(db.prepare(sql).run(params).lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, fields[k]])) };
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },

    /** Limpia `completed_at` (se usa al reabrir una tarea `done`). */
    clearCompletedAt: (id) =>
      db.prepare('UPDATE tasks SET completed_at = NULL WHERE id = ?').run(id),
    remove: (id) => db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes,
  };
}
