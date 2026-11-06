-- 003_sessions: almacén de sesiones de express-session (store propio, ver ARQUITECTURA §7).
CREATE TABLE sessions (
  sid        TEXT PRIMARY KEY,
  sess       TEXT NOT NULL CHECK (json_valid(sess)),
  expires_at INTEGER NOT NULL
);
CREATE INDEX ix_sessions_expires ON sessions(expires_at);
