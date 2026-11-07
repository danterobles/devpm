// Respaldo en caliente de la base de datos con retención (RNF-09).
// Uso: npm run db:backup   (variables: DATABASE_PATH, BACKUP_DIR, BACKUP_RETENTION_DAYS)
import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config/index.js';
import { backupDatabase } from '../src/db/backup.js';
import { openDb } from '../src/db/connection.js';

const config = loadConfig();

if (!existsSync(config.databasePath)) {
  console.error(`La base de datos no existe: ${config.databasePath}`);
  process.exit(1);
}

const db = openDb(config.databasePath);
try {
  const { file, bytes, removed } = backupDatabase({
    db,
    dir: config.backupDir,
    retentionDays: config.backupRetentionDays,
  });
  console.log(`Respaldo creado: ${file} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(
    `Eliminados por retención: ${removed.length}${removed.length ? ` (${removed.join(', ')})` : ''}`,
  );
} catch (err) {
  console.error(`El respaldo falló: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
