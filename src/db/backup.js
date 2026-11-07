import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Nombre de un respaldo: `devpm-AAAAMMDD-HHmm.db` en UTC (más `-N` si hay otro del mismo minuto). */
export const BACKUP_PATTERN = /^devpm-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(?:-(\d+))?\.db$/;

export function backupName(date, copy = 1) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
  return `devpm-${stamp}${copy > 1 ? `-${copy}` : ''}.db`;
}

/** Fecha (UTC) codificada en el nombre de un respaldo, o `null` si no es un respaldo. */
function backupDate(name) {
  const m = BACKUP_PATTERN.exec(name);
  return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

/** Comprueba la integridad de la copia; devuelve `'ok'` o el mensaje de SQLite. */
function integrityOf(file) {
  const copy = new Database(file, { readonly: true });
  try {
    return copy.pragma('integrity_check', { simple: true });
  } finally {
    copy.close();
  }
}

/**
 * Respaldo en caliente (RNF-09): `VACUUM INTO` genera una copia consistente de un solo archivo sin
 * detener la aplicación (WAL), se verifica y después se aplica la retención.
 * @param {{ db: import('better-sqlite3').Database, dir: string, retentionDays: number, now?: Date, verify?: (file: string) => string }} options
 * @returns {{ file: string, bytes: number, removed: string[] }}
 */
export function backupDatabase({ db, dir, retentionDays, now = new Date(), verify = integrityOf }) {
  // Los respaldos contienen los hashes de contraseña: solo el usuario del servicio puede leerlos.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  let copy = 1;
  let file = join(dir, backupName(now, copy));
  while (existsSync(file)) {
    copy += 1;
    file = join(dir, backupName(now, copy));
  }

  db.prepare('VACUUM INTO ?').run(file);
  chmodSync(file, 0o600);
  const verdict = verify(file);
  if (verdict !== 'ok') {
    rmSync(file, { force: true });
    throw new Error(`La copia no pasó la verificación de integridad: ${verdict}`);
  }

  // Retención: se comparan con el minuto actual (el nombre solo tiene precisión de minutos).
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const limit = retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const name of readdirSync(dir)) {
    const date = backupDate(name);
    if (date && join(dir, name) !== file && minute - date > limit) {
      rmSync(join(dir, name), { force: true });
      removed.push(name);
    }
  }
  return { file, bytes: statSync(file).size, removed };
}
