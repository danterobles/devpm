export function createGanttRepository(db) {
  const project = db.prepare(
    'SELECT id, code, name, start_date, end_date FROM projects WHERE id = ?',
  );
  const tasks = db.prepare(
    `SELECT t.id, t.title, t.status, t.start_date, t.due_date, t.estimated_minutes, t.parent_task_id,
            t.sprint_id, s.name AS sprint_name, s.start_date AS sprint_start,
            trim(m.first_name || ' ' || m.last_name) AS assignee_name,
            COALESCE((SELECT SUM(e.minutes) FROM time_entries e
                       WHERE e.task_id = t.id AND e.status IN ('submitted','approved')), 0) AS logged_minutes
       FROM tasks t
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN team_members m ON m.id = t.assignee_id
      WHERE t.project_id = ?`,
  );
  const dependencies = db.prepare(
    `SELECT d.task_id, d.depends_on_task_id
       FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
      WHERE t.project_id = ?`,
  );
  const milestones = db.prepare(
    'SELECT id, name, due_date, status FROM milestones WHERE project_id = ? ORDER BY due_date, id',
  );

  return {
    findProject: (id) => project.get(id),
    tasksOf: (projectId) => tasks.all(projectId),
    dependenciesOf: (projectId) => dependencies.all(projectId),
    milestonesOf: (projectId) => milestones.all(projectId),
  };
}
