-- 002_indexes_views: índices (docs/DATA.md §4), sprint activo único y vistas de KPIs (§5).

CREATE INDEX ix_clients_type_active       ON clients(type, is_active);
CREATE INDEX ix_projects_client           ON projects(client_id);
CREATE INDEX ix_projects_manager          ON projects(manager_id);
CREATE INDEX ix_projects_status           ON projects(status);
CREATE INDEX ix_milestones_project_due    ON milestones(project_id, due_date);
CREATE INDEX ix_assignments_member_period ON assignments(team_member_id, start_date, end_date);
CREATE INDEX ix_assignments_project       ON assignments(project_id);
CREATE INDEX ix_sprints_project_status    ON sprints(project_id, status);
CREATE INDEX ix_tasks_project_status      ON tasks(project_id, status);
CREATE INDEX ix_tasks_sprint_status       ON tasks(sprint_id, status);
CREATE INDEX ix_tasks_assignee_status     ON tasks(assignee_id, status);
CREATE INDEX ix_tasks_due                 ON tasks(due_date) WHERE status <> 'done';
CREATE INDEX ix_task_history_task         ON task_status_history(task_id, changed_at);
CREATE INDEX ix_time_member_date          ON time_entries(team_member_id, work_date);
CREATE INDEX ix_time_project_date         ON time_entries(project_id, work_date);
CREATE INDEX ix_time_status               ON time_entries(status);
CREATE INDEX ix_time_off_member           ON time_off(team_member_id, start_date, end_date);
CREATE INDEX ix_audit_entity              ON audit_log(entity, entity_id);

-- Un solo sprint activo por proyecto (RF-60)
CREATE UNIQUE INDEX ux_sprints_one_active ON sprints(project_id) WHERE status = 'active';

-- Avance y consumo por proyecto (K2, K3, K4, K5). Solo tareas de primer nivel cuentan puntos.
CREATE VIEW v_project_progress AS
SELECT
  p.id AS project_id,
  p.status, p.start_date, p.end_date, p.budget_minutes,
  COALESCE(SUM(t.story_points), 0) AS total_points,
  COALESCE(SUM(CASE WHEN t.status = 'done' THEN t.story_points END), 0) AS done_points,
  (SELECT COALESCE(SUM(te.minutes), 0) FROM time_entries te
     WHERE te.project_id = p.id AND te.status IN ('submitted','approved')) AS spent_minutes
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id AND t.parent_task_id IS NULL
GROUP BY p.id;

-- Dedicación asignada por miembro (K7); se filtra por periodo en la consulta
CREATE VIEW v_member_allocations AS
SELECT a.team_member_id, a.project_id, a.allocation_percent, a.start_date, a.end_date
FROM assignments a
JOIN projects p ON p.id = a.project_id
WHERE p.status IN ('planning','active');

-- Horas por miembro, proyecto, día y tipo de cliente (K6, K13, K14, K16)
CREATE VIEW v_time_by_client_type AS
SELECT te.work_date, te.team_member_id, te.project_id, te.minutes, te.is_billable, te.status,
       c.id AS client_id, c.type AS client_type, c.hourly_rate_cents, c.currency
FROM time_entries te
JOIN projects p ON p.id = te.project_id
JOIN clients  c ON c.id = p.client_id;
