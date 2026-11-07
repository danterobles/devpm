/** Acceso a datos de los comentarios de tareas (DATA §3.17). SQL solo con parámetros. */
export function createCommentsRepository(db) {
  const SELECT = `SELECT c.*, u.full_name AS author_name, u.email AS author_email
                    FROM task_comments c LEFT JOIN users u ON u.id = c.user_id`;
  const q = {
    byId: db.prepare(`${SELECT} WHERE c.id = ?`),
    byTask: db.prepare(`${SELECT} WHERE c.task_id = ? ORDER BY c.id`),
    insert: db.prepare('INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)'),
    update: db.prepare(
      "UPDATE task_comments SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ),
    remove: db.prepare('DELETE FROM task_comments WHERE id = ?'),
    task: db.prepare('SELECT id, project_id, title, assignee_id FROM tasks WHERE id = ?'),
    member: db.prepare('SELECT team_member_id FROM users WHERE id = ?').pluck(),
    assigned: db
      .prepare('SELECT 1 FROM assignments WHERE project_id = ? AND team_member_id = ? LIMIT 1')
      .pluck(),
    userByEmail: db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND is_active = 1'),
  };
  return {
    findById: (id) => q.byId.get(id),
    listByTask: (taskId) => q.byTask.all(taskId),
    insert: (taskId, userId, body) => Number(q.insert.run(taskId, userId, body).lastInsertRowid),
    update: (id, body) => q.update.run(body, id),
    remove: (id) => q.remove.run(id),
    findTask: (id) => q.task.get(id),
    memberOfUser: (userId) => q.member.get(userId) ?? null,
    isAssigned: (projectId, memberId) => q.assigned.get(projectId, memberId) === 1,
    activeUserIdByEmail: (email) => q.userByEmail.get(email)?.id ?? null,
  };
}
