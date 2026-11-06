-- 001_init: tablas de negocio (ver docs/DATA.md §3). Fechas ISO, minutos y centavos enteros.

CREATE TABLE team_members (
  id                      INTEGER PRIMARY KEY,
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  email                   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  position                TEXT NOT NULL CHECK (position IN ('frontend','backend','fullstack','qa','devops','designer','pm')),
  seniority               TEXT NOT NULL CHECK (seniority IN ('junior','mid','senior','lead')),
  weekly_capacity_minutes INTEGER NOT NULL DEFAULT 2400 CHECK (weekly_capacity_minutes BETWEEN 0 AND 4800),
  hourly_cost_cents       INTEGER NOT NULL DEFAULT 0 CHECK (hourly_cost_cents >= 0),
  hire_date               TEXT CHECK (hire_date IS date(hire_date)),
  is_active               INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','pm','developer','viewer')),
  team_member_id INTEGER UNIQUE REFERENCES team_members(id) ON DELETE SET NULL,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE clients (
  id                INTEGER PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('internal','external')),
  name              TEXT NOT NULL,
  contact_name      TEXT,
  contact_email     TEXT,
  contact_phone     TEXT,
  department        TEXT,
  cost_center       TEXT,
  legal_name        TEXT,
  tax_id            TEXT UNIQUE,
  hourly_rate_cents INTEGER CHECK (hourly_rate_cents >= 0),
  currency          TEXT NOT NULL DEFAULT 'MXN',
  address           TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (type = 'internal' AND department IS NOT NULL)
    OR (type = 'external' AND legal_name IS NOT NULL AND hourly_rate_cents IS NOT NULL)
  )
);

CREATE TABLE skills (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT CHECK (category IN ('language','framework','tool','soft'))
);

CREATE TABLE team_member_skills (
  team_member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  skill_id       INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  level          INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  PRIMARY KEY (team_member_id, skill_id)
);

CREATE TABLE time_off (
  id             INTEGER PRIMARY KEY,
  team_member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('vacation','sick','personal','holiday')),
  start_date     TEXT NOT NULL CHECK (start_date IS date(start_date)),
  end_date       TEXT NOT NULL CHECK (end_date IS date(end_date)),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE projects (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  manager_id        INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','on_hold','completed','cancelled')),
  priority          TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  methodology       TEXT NOT NULL DEFAULT 'scrum' CHECK (methodology IN ('scrum','kanban','waterfall')),
  start_date        TEXT NOT NULL CHECK (start_date IS date(start_date)),
  end_date          TEXT NOT NULL CHECK (end_date IS date(end_date)),
  actual_start_date TEXT CHECK (actual_start_date IS date(actual_start_date)),
  actual_end_date   TEXT CHECK (actual_end_date IS date(actual_end_date)),
  budget_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (budget_minutes >= 0),
  budget_cents      INTEGER CHECK (budget_cents >= 0),
  is_billable       INTEGER NOT NULL CHECK (is_billable IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE milestones (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  due_date     TEXT NOT NULL CHECK (due_date IS date(due_date)),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','missed')),
  completed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE assignments (
  id                 INTEGER PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_member_id     INTEGER NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
  project_role       TEXT NOT NULL,
  allocation_percent INTEGER NOT NULL CHECK (allocation_percent BETWEEN 1 AND 100),
  start_date         TEXT NOT NULL CHECK (start_date IS date(start_date)),
  end_date           TEXT NOT NULL CHECK (end_date IS date(end_date)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE sprints (
  id               INTEGER PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  goal             TEXT,
  start_date       TEXT NOT NULL CHECK (start_date IS date(start_date)),
  end_date         TEXT NOT NULL CHECK (end_date IS date(end_date)),
  status           TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','closed')),
  committed_points INTEGER,
  completed_points INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE tasks (
  id                INTEGER PRIMARY KEY,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprint_id         INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
  milestone_id      INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
  parent_task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  type              TEXT NOT NULL DEFAULT 'feature' CHECK (type IN ('feature','bug','chore','spike')),
  status            TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','todo','in_progress','in_review','done','blocked')),
  priority          TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  story_points      INTEGER CHECK (story_points IN (0,1,2,3,5,8,13,21)),
  estimated_minutes INTEGER CHECK (estimated_minutes >= 0),
  assignee_id       INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  start_date        TEXT CHECK (start_date IS date(start_date)),
  due_date          TEXT CHECK (due_date IS date(due_date)),
  started_at        TEXT,
  completed_at      TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_date IS NULL OR due_date IS NULL OR due_date >= start_date)
);

CREATE TABLE task_dependencies (
  task_id            INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type               TEXT NOT NULL DEFAULT 'FS' CHECK (type IN ('FS')),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE task_status_history (
  id          INTEGER PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE time_entries (
  id               INTEGER PRIMARY KEY,
  team_member_id   INTEGER NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  work_date        TEXT NOT NULL CHECK (work_date IS date(work_date)),
  minutes          INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description      TEXT NOT NULL,
  is_billable      INTEGER NOT NULL CHECK (is_billable IN (0,1)),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  approved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TEXT,
  rejection_reason TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);

CREATE TABLE sprint_daily_snapshots (
  sprint_id         INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  snapshot_date     TEXT NOT NULL CHECK (snapshot_date IS date(snapshot_date)),
  total_points      INTEGER NOT NULL,
  completed_points  INTEGER NOT NULL,
  remaining_points  INTEGER NOT NULL,
  remaining_minutes INTEGER NOT NULL DEFAULT 0,
  captured_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (sprint_id, snapshot_date)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('create','update','delete','status_change')),
  changes    TEXT CHECK (changes IS NULL OR json_valid(changes)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
