/** Acceso a datos de los adjuntos (DATA §3.18). SQL solo con parámetros. */
export function createAttachmentsRepository(db) {
  const SELECT = `SELECT a.*, u.full_name AS uploader_name
                    FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by`;
  const q = {
    byId: db.prepare(`${SELECT} WHERE a.id = ?`),
    byTask: db.prepare(`${SELECT} WHERE a.task_id = ? ORDER BY a.id`),
    count: db.prepare('SELECT count(*) FROM task_attachments WHERE task_id = ?').pluck(),
    insert: db.prepare(
      `INSERT INTO task_attachments (task_id, uploaded_by, original_name, stored_name, content_type, size_bytes)
       VALUES (@taskId, @userId, @originalName, @storedName, @contentType, @sizeBytes)`,
    ),
    remove: db.prepare('DELETE FROM task_attachments WHERE id = ?'),
    storedNames: db.prepare('SELECT stored_name FROM task_attachments').pluck(),
    task: db.prepare('SELECT id, project_id FROM tasks WHERE id = ?'),
    member: db.prepare('SELECT team_member_id FROM users WHERE id = ?').pluck(),
    assigned: db
      .prepare('SELECT 1 FROM assignments WHERE project_id = ? AND team_member_id = ? LIMIT 1')
      .pluck(),
  };
  return {
    findById: (id) => q.byId.get(id),
    listByTask: (taskId) => q.byTask.all(taskId),
    countByTask: (taskId) => q.count.get(taskId),
    insert: (row) => Number(q.insert.run(row).lastInsertRowid),
    remove: (id) => q.remove.run(id),
    allStoredNames: () => new Set(q.storedNames.all()),
    findTask: (id) => q.task.get(id),
    memberOfUser: (userId) => q.member.get(userId) ?? null,
    isAssigned: (projectId, memberId) => q.assigned.get(projectId, memberId) === 1,
  };
}
