import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { verifyOrigin } from '../../src/middlewares/verifyOrigin.js';
import { createErrorHandler } from '../../src/middlewares/errorHandler.js';

function buildHost() {
  const host = express();
  host.use(verifyOrigin);
  host.all('/api/x', (_req, res) => res.json({ ok: true }));
  host.use(createErrorHandler({ error() {} }));
  return host;
}

test('POST con Origin de otro sitio se rechaza con 403', async () => {
  const res = await request(buildHost()).post('/api/x').set('Origin', 'https://evil.example');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('POST con Origin igual al Host pasa', async () => {
  const app = buildHost();
  const srv = request(app);
  const host = '127.0.0.1:3000';
  const res = await srv.post('/api/x').set('Host', host).set('Origin', `http://${host}`);
  assert.equal(res.status, 200);
});

for (const method of ['put', 'patch', 'delete']) {
  test(`${method.toUpperCase()} con Origin ajeno se rechaza`, async () => {
    const res = await request(buildHost())[method]('/api/x').set('Origin', 'https://evil.example');
    assert.equal(res.status, 403);
  });
}

test('sin Origin se usa Referer: ajeno se rechaza, propio pasa', async () => {
  const bad = await request(buildHost()).post('/api/x').set('Referer', 'https://evil.example/page');
  assert.equal(bad.status, 403);
  const ok = await request(buildHost())
    .post('/api/x')
    .set('Host', 'app.test')
    .set('Referer', 'http://app.test/page');
  assert.equal(ok.status, 200);
});

test('Origin "null" se rechaza', async () => {
  const res = await request(buildHost()).post('/api/x').set('Origin', 'null');
  assert.equal(res.status, 403);
});

test('sin Origin ni Referer (cliente no navegador) pasa', async () => {
  assert.equal((await request(buildHost()).post('/api/x')).status, 200);
});

test('métodos seguros (GET) no se verifican', async () => {
  const res = await request(buildHost()).get('/api/x').set('Origin', 'https://evil.example');
  assert.equal(res.status, 200);
});
