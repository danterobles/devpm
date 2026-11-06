import { loadConfig } from './config/index.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';
import { openDb } from './db/connection.js';
import { createBurndownJob } from './jobs/burndownSnapshot.js';
import { createSnapshotsService } from './modules/burndown/snapshots.service.js';

const config = loadConfig();
const logger = createLogger(config);
const db = openDb(config.databasePath);
const app = createApp({ config, db, logger });

// Limpieza periódica de sesiones vencidas
const pruneTimer = setInterval(() => app.locals.sessionStore.prune(), 60 * 60 * 1000);
pruneTimer.unref();

// Burndown: relleno de días faltantes al arrancar y corte diario a las 23:55 (zona de la aplicación)
const burndownJob = createBurndownJob({
  snapshots: createSnapshotsService({ db, timezone: config.timezone }),
  timezone: config.timezone,
  logger,
});
burndownJob.start();

const server = app.listen(config.port, () => {
  logger.info(`DevPM escuchando en http://localhost:${config.port} (${config.env})`);
});

function shutdown(signal) {
  logger.info(`${signal} recibido, cerrando...`);
  burndownJob.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
