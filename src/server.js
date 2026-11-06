import { loadConfig } from './config/index.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger(config);
const app = createApp({ config, logger });

const server = app.listen(config.port, () => {
  logger.info(`DevPM escuchando en http://localhost:${config.port} (${config.env})`);
});

function shutdown(signal) {
  logger.info(`${signal} recibido, cerrando...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
