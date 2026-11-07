-- 007_accounts_security: recuperación de contraseña, 2FA, eventos de seguridad y preferencias de avisos
-- (PRD §5.18 a §5.20, DATA §3.20).
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1));
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;

CREATE TABLE password_resets (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_password_resets_user ON password_resets(user_id);

CREATE TABLE recovery_codes (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, code_hash)
);

CREATE TABLE security_events (
  id         INTEGER PRIMARY KEY,
  type       TEXT    NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT,
  ip         TEXT,
  detail     TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_security_events_created ON security_events(created_at);
CREATE INDEX ix_security_events_type ON security_events(type, created_at);

CREATE TABLE notification_preferences (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    TEXT    NOT NULL,
  in_app  INTEGER NOT NULL DEFAULT 1 CHECK (in_app IN (0, 1)),
  email   INTEGER NOT NULL DEFAULT 1 CHECK (email IN (0, 1)),
  PRIMARY KEY (user_id, type)
);
