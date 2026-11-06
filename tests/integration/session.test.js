import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { buildTestApp, testConfig } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { createApp } from '../../src/app.js';
import { createSession } from '../../src/modules/auth/session.js';

test('visitante anónimo no recibe cookie de sesión', async () => {
  const app = createApp({ config: testConfig(), db: createTestDb() });
  const res = await request(app).get('/');
  assert.equal(res.headers['set-cookie'], undefined);
});

test('app sin BD no instala sesiones y sigue funcionando', async () => {
  const res = await request(buildTestApp()).get('/health');
  assert.equal(res.status, 200);
});

for (const [env, secure] of [
  ['test', false],
  ['production', true],
]) {
  test(`cookie de sesión (${env}): HttpOnly, SameSite=Strict, Secure=${secure}`, async () => {
    const db = createTestDb();
    const host = express();
    host.set('trust proxy', 1);
    host.use(createSession({ config: testConfig({ NODE_ENV: env }), db }).middleware);
    host.get('/__login', (req, res, next) => {
      req.session.userId = 1;
      req.session.save((e) => (e ? next(e) : res.send('ok')));
    });

    const res = await request(host).get('/__login').set('X-Forwarded-Proto', 'https');
    const cookie = res.headers['set-cookie'][0];
    assert.match(cookie, /^devpm\.sid=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(/Secure/.test(cookie), secure);
    assert.equal(db.prepare('SELECT count(*) FROM sessions').pluck().get(), 1);
  });
}

test('la sesión persiste entre peticiones con la misma cookie', async () => {
  const db = createTestDb();
  const host = express();
  host.use(createSession({ config: testConfig(), db }).middleware);
  host.get('/set', (req, res) => {
    req.session.userId = 42;
    res.send('ok');
  });
  host.get('/get', (req, res) => res.json({ userId: req.session.userId ?? null }));

  const agent = request.agent(host);
  await agent.get('/set');
  assert.equal((await agent.get('/get')).body.userId, 42);
  assert.equal((await request(host).get('/get')).body.userId, null);
});
