import session from 'express-session';
import { SqliteSessionStore } from './sqliteSessionStore.js';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // expiración por inactividad: 8 h
export const SESSION_COOKIE = 'devpm.sid';

/** Crea el middleware de sesión y su store. Cookie HttpOnly, SameSite=Strict, Secure en producción. */
export function createSession({ config, db }) {
  const store = new SqliteSessionStore(db, { ttlMs: SESSION_TTL_MS });
  const middleware = session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false, // no se crea sesión (ni cookie) para visitantes anónimos
    rolling: true, // renueva la expiración con cada petición
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.isProduction,
      maxAge: SESSION_TTL_MS,
    },
  });
  return { middleware, store };
}
