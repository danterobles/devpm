import pino from 'pino';

export function createLogger(config) {
  const options = { level: config.logLevel };
  if (config.env === 'development') {
    options.transport = { target: 'pino-pretty', options: { colorize: true } };
  }
  return pino(options);
}
