import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Aplica en orden las migraciones NNN_descripcion.sql pendientes, cada una en su transacción.
 * Las migraciones ya aplicadas no se editan ni se reejecutan.
 * @returns {string[]} versiones aplicadas en esta ejecución
 */
export function migrate(db, dir = defaultDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all());
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  const done = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    })();
    done.push(version);
  }
  return done;
}
