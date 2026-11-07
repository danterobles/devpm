-- 005_notifications: avisos dentro de la aplicación y preferencia de correo (PRD §5.12, DATA §3.16).
ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1 CHECK (email_notifications IN (0, 1));

CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  link        TEXT,
  dedupe_key  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT
);

-- Sin duplicados: un mismo aviso periódico no se repite para la misma persona.
CREATE UNIQUE INDEX ux_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ix_notifications_user_unread ON notifications(user_id, read_at, id DESC);
CREATE INDEX ix_notifications_user_created ON notifications(user_id, created_at DESC);
