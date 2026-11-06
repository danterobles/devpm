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

  const portfolio = db.prepare(
    `SELECT p.id, p.code, p.name, p.start_date, p.end_date, p.priority,
            c.name AS client_name, trim(m.first_name || ' ' || m.last_name) AS manager_name,
            COALESCE((SELECT SUM(story_points) FROM tasks WHERE project_id = p.id), 0) AS total_points,
            COALESCE((SELECT SUM(story_points) FROM tasks WHERE project_id = p.id AND status = 'done'), 0) AS done_points,
            (SELECT count(*) FROM tasks WHERE project_id = p.id) AS task_count,
            (SELECT count(*) FROM tasks WHERE project_id = p.id AND status = 'done') AS done_count
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN team_members m ON m.id = p.manager_id
      WHERE p.status = 'active'
      ORDER BY p.start_date, p.code`,
  );

  return {
    activeProjects: () => portfolio.all(),
    findProject: (id) => project.get(id),
    tasksOf: (projectId) => tasks.all(projectId),
    dependenciesOf: (projectId) => dependencies.all(projectId),
    milestonesOf: (projectId) => milestones.all(projectId),
  };
}
