/** Consultas de solo lectura de los avisos periódicos (PRD §5.12.1). */
export function createRemindersRepository(db) {
  const q = {
    members: db.prepare(
      `SELECT m.id AS member_id, m.weekly_capacity_minutes AS capacity, u.id AS user_id
         FROM team_members m JOIN users u ON u.team_member_id = m.id
        WHERE m.is_active = 1 AND u.is_active = 1 AND u.role IN ('developer','pm','admin')`,
    ),
    logged: db
      .prepare(
        `SELECT coalesce(sum(minutes), 0) FROM time_entries
          WHERE team_member_id = ? AND work_date BETWEEN ? AND ?`,
      )
      .pluck(),
    editable: db
      .prepare(
        `SELECT count(*) FROM time_entries
          WHERE team_member_id = ? AND work_date BETWEEN ? AND ? AND status IN ('draft','rejected')`,
      )
      .pluck(),
    overdueTasks: db.prepare(
      `SELECT t.id, t.title, t.assignee_id AS member_id, t.due_date, p.code AS project_code
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.status <> 'done' AND t.assignee_id IS NOT NULL AND t.due_date < ?
          AND p.status = 'active'`,
    ),
    overdueMilestones: db.prepare(
      `SELECT ms.id, ms.name, ms.due_date, ms.project_id, p.code AS project_code
         FROM milestones ms JOIN projects p ON p.id = ms.project_id
        WHERE ms.status = 'pending' AND ms.due_date < ? AND p.status = 'active'`,
    ),
  };
  return {
    members: () => q.members.all(),
    loggedMinutes: (memberId, from, to) => q.logged.get(memberId, from, to),
    editableCount: (memberId, from, to) => q.editable.get(memberId, from, to),
    overdueTasks: (today) => q.overdueTasks.all(today),
    overdueMilestones: (today) => q.overdueMilestones.all(today),
  };
}
