import { loadConfig } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(40),
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function buildTestApp(deps = {}) {
  return createApp({ config: testConfig(), ...deps });
}
