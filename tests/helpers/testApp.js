import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';

// Los adjuntos de las pruebas van a una carpeta temporal (nunca a `data/uploads` del proyecto).
const UPLOAD_DIR = path.join(os.tmpdir(), `devpm-test-uploads-${process.pid}`);

export function testConfig(overrides = {}) {
  return loadConfig({
    UPLOAD_DIR,
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(40),
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function buildTestApp(deps = {}) {
  return createApp({ config: testConfig(), ...deps });
}
