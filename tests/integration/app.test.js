import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';

test('GET /health responde ok', async () => {
  const res = await request(buildTestApp()).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('GET /health reporta la base de datos si existe', async () => {
  const db = { prepare: () => ({ get: () => ({}) }) };
  const res = await request(buildTestApp({ db })).get('/health');
  assert.equal(res.body.db, 'ok');
});

test('GET /health devuelve 503 si la base de datos falla', async () => {
  const db = {
    prepare: () => {
      throw new Error('boom');
    },
  };
  const res = await request(buildTestApp({ db })).get('/health');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'degraded');
});

test('GET / renderiza la página con layout y cabeceras de seguridad', async () => {
  const res = await request(buildTestApp()).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /<title>Inicio · DevPM<\/title>/);
  assert.match(res.text, /<nav/);
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('ruta inexistente en /api devuelve 404 JSON', async () => {
  const res = await request(buildTestApp()).get('/api/v1/nada');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('ruta HTML inexistente renderiza página de error', async () => {
  const res = await request(buildTestApp()).get('/nada');
  assert.equal(res.status, 404);
  assert.match(res.text, /Error 404/);
});

test('JSON malformado devuelve 400 y no 500', async () => {
  const res = await request(buildTestApp())
    .post('/api/v1/x')
    .set('Content-Type', 'application/json')
    .send('{mal');
  assert.equal(res.status, 400);
});

test('archivos estáticos locales se sirven', async () => {
  const res = await request(buildTestApp()).get('/vendor/chart.umd.min.js');
  assert.equal(res.status, 200);
});
