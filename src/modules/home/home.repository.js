/** Consultas de solo lectura del panel «Mi día» (PRD §5.13). */
export function createHomeRepository(db) {
  const q = {
    member: db.prepare(
      `SELECT m.id, m.weekly_capacity_minutes AS capacity
           FROM users u JOIN team_members m ON m.id = u.team_member_id
          WHERE u.id = ? AND m.is_active = 1`,
    ),
    openTasks: db.prepare(
      `SELECT t.id, t.title, t.status, t.due_date, t.story_points AS points, p.code AS project_code
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_id = ? AND t.status IN ('todo','in_progress','in_review','blocked')
          AND p.status IN ('planning','active')
        ORDER BY (t.due_date IS NULL), t.due_date, t.id
        LIMIT 8`,
    ),
    logged: db
      .prepare(
        `SELECT coalesce(sum(minutes), 0) FROM time_entries
          WHERE team_member_id = ? AND work_date BETWEEN ? AND ?`,
      )
      .pluck(),
    byStatus: db.prepare(
      `SELECT status, count(*) AS n FROM time_entries
        WHERE team_member_id = ? AND work_date BETWEEN ? AND ? GROUP BY status`,
    ),
    rejected: db.prepare(
      `SELECT e.id, e.work_date, e.minutes, e.rejection_reason AS reason, p.code AS project_code
         FROM time_entries e JOIN projects p ON p.id = e.project_id
        WHERE e.team_member_id = ? AND e.status = 'rejected'
        ORDER BY e.work_date DESC, e.id DESC LIMIT 5`,
    ),
    pending: db
      .prepare(
        `SELECT count(*) FROM time_entries e JOIN projects p ON p.id = e.project_id
          WHERE e.status = 'submitted' AND (? IS NULL OR p.manager_id = ?)
            AND (? IS NULL OR e.team_member_id <> ?)`,
      )
      .pluck(),
    managedProjects: db
      .prepare("SELECT id FROM projects WHERE manager_id = ? AND status = 'active'")
      .pluck(),
    milestones: db.prepare(
      `SELECT ms.id, ms.name, ms.due_date, ms.project_id, p.code AS project_code
         FROM milestones ms JOIN projects p ON p.id = ms.project_id
        WHERE ms.status = 'pending' AND ms.due_date <= ? AND p.status = 'active'
          AND (? IS NULL OR p.manager_id = ?)
        ORDER BY ms.due_date, ms.id LIMIT 6`,
    ),
    blocked: db.prepare(
      `SELECT t.id, t.title, p.code AS project_code
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.status = 'blocked' AND p.status = 'active' AND (? IS NULL OR p.manager_id = ?)
        ORDER BY t.id DESC LIMIT 6`,
    ),
    activeProjects: db.prepare(
      `SELECT p.id, p.code, p.name, p.end_date, v.total_points AS total, v.done_points AS done
         FROM projects p JOIN v_project_progress v ON v.project_id = p.id
        WHERE p.status = 'active' ORDER BY p.code LIMIT 12`,
    ),
  };
  return {
    memberOf: (userId) => q.member.get(userId) ?? null,
    openTasks: (memberId) => q.openTasks.all(memberId),
    loggedMinutes: (memberId, from, to) => q.logged.get(memberId, from, to),
    entriesByStatus: (memberId, from, to) =>
      Object.fromEntries(q.byStatus.all(memberId, from, to).map((r) => [r.status, r.n])),
    rejectedEntries: (memberId) => q.rejected.all(memberId),
    pendingApprovals: (managerId, ownMemberId) =>
      q.pending.get(managerId, managerId, ownMemberId, ownMemberId),
    managedProjectIds: (memberId) => q.managedProjects.all(memberId),
    milestonesUntil: (until, managerId) => q.milestones.all(until, managerId, managerId),
    blockedTasks: (managerId) => q.blocked.all(managerId, managerId),
    activeProjects: () => q.activeProjects.all(),
  };
}
