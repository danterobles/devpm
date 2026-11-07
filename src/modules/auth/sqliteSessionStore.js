import { createHash } from 'node:crypto';
import session from 'express-session';

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/** El ID de sesión se guarda con hash: una copia de la base no sirve para suplantar sesiones. */
const keyOf = (sid) => createHash('sha256').update(sid).digest('hex');

/** Store de express-session sobre better-sqlite3 (síncrono, sin dependencias extra). */
export class SqliteSessionStore extends session.Store {
  constructor(db, { ttlMs = DEFAULT_TTL_MS } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.q = {
      get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires_at > ?'),
      set: db.prepare(
        `INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`,
      ),
      touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
      count: db.prepare('SELECT count(*) FROM sessions WHERE expires_at > ?').pluck(),
      destroyUser: db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?"),
    };
  }

  #expiry(sess) {
    const exp = sess?.cookie?.expires ? Date.parse(sess.cookie.expires) : NaN;
    return Number.isNaN(exp) ? Date.now() + this.ttlMs : exp;
  }

  #run(cb, fn) {
    try {
      const result = fn();
      if (cb) cb(null, result);
    } catch (err) {
      if (cb) cb(err);
      else throw err;
    }
  }

  get(sid, cb) {
    this.#run(cb, () => {
      const row = this.q.get.get(keyOf(sid), Date.now());
      return row ? JSON.parse(row.sess) : null;
    });
  }

  set(sid, sess, cb) {
    this.#run(cb, () => {
      this.q.set.run(keyOf(sid), JSON.stringify(sess), this.#expiry(sess));
    });
  }

  touch(sid, sess, cb) {
    this.#run(cb, () => {
      this.q.touch.run(this.#expiry(sess), keyOf(sid));
    });
  }

  destroy(sid, cb) {
    this.#run(cb, () => {
      this.q.destroy.run(keyOf(sid));
    });
  }

  /** Elimina sesiones vencidas; devuelve cuántas. */
  prune() {
    return this.q.prune.run(Date.now()).changes;
  }

  /** Cierra todas las sesiones de un usuario (p. ej. al desactivarlo o cambiar contraseña). */
  destroyByUser(userId) {
    return this.q.destroyUser.run(userId).changes;
  }

  length(cb) {
    this.#run(cb, () => this.q.count.get(Date.now()));
  }
}
