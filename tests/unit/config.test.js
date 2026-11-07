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

test('config: el correo es opcional; sin SMTP_HOST queda deshabilitado y APP_URL se deduce del puerto', () => {
  const c = loadConfig({ SESSION_SECRET: 'a'.repeat(32), PORT: '4000' });
  assert.equal(c.smtp.host, null);
  assert.equal(c.smtp.port, 587);
  assert.equal(c.smtp.secure, false);
  assert.equal(c.appUrl, 'http://localhost:4000');
});

test('config: lee SMTP_* y APP_URL (sin barra final) y rechaza valores inválidos', () => {
  const c = loadConfig({
    SESSION_SECRET: 'a'.repeat(32),
    APP_URL: 'https://devpm.ejemplo.com/',
    SMTP_HOST: 'smtp.ejemplo.com',
    SMTP_PORT: '465',
    SMTP_USER: 'u',
    SMTP_PASS: 'p',
    SMTP_SECURE: 'true',
    SMTP_FROM: 'DevPM <no-reply@ejemplo.com>',
  });
  assert.equal(c.appUrl, 'https://devpm.ejemplo.com');
  assert.deepEqual(c.smtp, {
    host: 'smtp.ejemplo.com',
    port: 465,
    user: 'u',
    pass: 'p',
    from: 'DevPM <no-reply@ejemplo.com>',
    secure: true,
  });
  assert.throws(
    () => loadConfig({ SESSION_SECRET: 'a'.repeat(32), APP_URL: 'no-es-url' }),
    /APP_URL/,
  );
  assert.throws(
    () => loadConfig({ SESSION_SECRET: 'a'.repeat(32), SMTP_SECURE: 'quizá' }),
    /SMTP_SECURE/,
  );
});
