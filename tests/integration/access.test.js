import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createTestDb } from '../helpers/testDb.js';
import { testConfig } from '../helpers/testApp.js';
import { createSession } from '../../src/modules/auth/session.js';
import { createErrorHandler } from '../../src/middlewares/errorHandler.js';
import { requireAuth } from '../../src/middlewares/requireAuth.js';
import { requireRole } from '../../src/middlewares/requireRole.js';

function buildHost() {
  const host = express();
  host.set('view engine', 'ejs');
  host.set('views', new URL('../../src/views', import.meta.url).pathname);
  host.use(createSession({ config: testConfig(), db: createTestDb() }).middleware);
  host.get('/__as/:role', (req, res) => {
    req.session.userId = 1;
    req.session.role = req.params.role;
    res.send('ok');
  });
  host.get('/page', requireAuth, (_req, res) => res.send('page'));
  host.get('/api/v1/thing', requireAuth, (_req, res) => res.json({ ok: true }));
  host.get('/api/v1/admin', requireAuth, requireRole('admin', 'pm'), (_req, res) =>
    res.json({ ok: true }),
  );
  host.get('/admin-page', requireAuth, requireRole('admin'), (_req, res) => res.send('admin'));
  host.use(createErrorHandler({ error() {} }));
  return host;
}

test('requireAuth: API sin sesión responde 401 JSON UNAUTHENTICATED', async () => {
  const res = await request(buildHost()).get('/api/v1/thing');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
});

test('requireAuth: página HTML sin sesión redirige a /login', async () => {
  const res = await request(buildHost()).get('/page');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});

test('requireAuth: con sesión deja pasar', async () => {
  const agent = request.agent(buildHost());
  await agent.get('/__as/viewer');
  assert.equal((await agent.get('/api/v1/thing')).status, 200);
  assert.equal((await agent.get('/page')).status, 200);
});

test('requireRole: rol permitido pasa, rol no permitido recibe 403 FORBIDDEN', async () => {
  const host = buildHost();
  const pm = request.agent(host);
  await pm.get('/__as/pm');
  assert.equal((await pm.get('/api/v1/admin')).status, 200);

  const dev = request.agent(host);
  await dev.get('/__as/developer');
  const res = await dev.get('/api/v1/admin');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('requireRole: página HTML con rol insuficiente responde 403', async () => {
  const host = buildHost();
  const agent = request.agent(host);
  await agent.get('/__as/pm');
  assert.equal((await agent.get('/admin-page')).status, 403);
});

test('requireRole sin sesión responde 401 aunque no se use requireAuth antes', async () => {
  const host = express();
  host.use(createSession({ config: testConfig(), db: createTestDb() }).middleware);
  host.get('/api/x', requireRole('admin'), (_req, res) => res.json({}));
  host.use(createErrorHandler({ error() {} }));
  assert.equal((await request(host).get('/api/x')).status, 401);
});

test('requireRole exige al menos un rol', () => {
  assert.throws(() => requireRole(), /al menos un rol/);
});
