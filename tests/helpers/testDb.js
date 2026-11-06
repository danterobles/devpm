import { openDb } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';

/** BD SQLite en memoria con todas las migraciones aplicadas. */
export function createTestDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}
