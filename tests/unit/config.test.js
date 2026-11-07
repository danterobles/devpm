import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config/index.js';

test('config: aplica valores por defecto', () => {
  const c = loadConfig({ SESSION_SECRET: 'a'.repeat(32) });
  assert.equal(c.port, 3000);
  assert.equal(c.env, 'development');
  assert.equal(c.timezone, 'America/Mexico_City');
});

test('config: rechaza SESSION_SECRET corto o ausente', () => {
  assert.throws(() => loadConfig({ SESSION_SECRET: 'corto' }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({}), /Configuración inválida/);
});

test('config: convierte PORT a número', () => {
  const c = loadConfig({ SESSION_SECRET: 'a'.repeat(32), PORT: '8080' });
  assert.equal(c.port, 8080);
});

test('en producción se rechaza el SESSION_SECRET de ejemplo (aunque tenga 32+ caracteres)', () => {
  const base = { NODE_ENV: 'production', LOG_LEVEL: 'silent' };
  assert.throws(
    () => loadConfig({ ...base, SESSION_SECRET: 'cambia-este-secreto-por-uno-largo-y-aleatorio' }),
    /SESSION_SECRET/,
  );
  assert.doesNotThrow(() => loadConfig({ ...base, SESSION_SECRET: 'a'.repeat(48) }));
  // en desarrollo y pruebas el valor de ejemplo sigue permitido
  assert.doesNotThrow(() =>
    loadConfig({
      NODE_ENV: 'development',
      SESSION_SECRET: 'cambia-este-secreto-por-uno-largo-y-aleatorio',
    }),
  );
});
