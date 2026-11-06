// CLI: node src/db/cli.js <migrate|seed|reset>
import { rmSync } from 'node:fs';
import { loadConfig } from '../config/index.js';
import { openDb } from './connection.js';
import { migrate } from './migrate.js';

const command = process.argv[2];
const config = loadConfig();

if (command === 'reset') {
  if (config.isProduction) {
    console.error('db:reset está deshabilitado en producción.');
    process.exit(1);
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(config.databasePath + suffix, { force: true });
}

const db = openDb(config.databasePath);
try {
  if (['migrate', 'seed', 'reset'].includes(command)) {
    const applied = migrate(db);
    console.log(
      applied.length
        ? `Migraciones aplicadas: ${applied.join(', ')}`
        : 'Sin migraciones pendientes',
    );
  }
  if (command === 'seed' || command === 'reset') {
    if (config.isProduction) throw new Error('El seed solo se permite en desarrollo.');
    const { seed } = await import('./seeds/dev.js');
    const summary = await seed(db, { timezone: config.timezone });
    console.log('Datos de ejemplo cargados:', summary);
  }
  if (!['migrate', 'seed', 'reset'].includes(command)) {
    console.error('Uso: node src/db/cli.js <migrate|seed|reset>');
    process.exitCode = 1;
  }
} finally {
  db.close();
}
