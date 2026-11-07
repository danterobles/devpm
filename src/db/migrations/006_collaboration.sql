-- 006_collaboration: comentarios, adjuntos y filtros guardados de la v0.4 (PRD §5.15 a §5.17, DATA §3.17 a §3.19).
CREATE TABLE task_comments (
  id         INTEGER PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at  TEXT
);
CREATE INDEX ix_task_comments_task ON task_comments(task_id, id);

CREATE TABLE task_attachments (
  id            INTEGER PRIMARY KEY,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL UNIQUE,
  content_type  TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_task_attachments_task ON task_attachments(task_id);

CREATE TABLE saved_filters (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT    NOT NULL CHECK (scope IN ('projects','tasks','time')),
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  query      TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, scope, name)
);
CREATE INDEX ix_saved_filters_user ON saved_filters(user_id, scope);
