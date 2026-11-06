import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { loadConfig } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../helpers/testDb.js';
import { createEventBus } from '../../src/realtime/eventBus.js';
import { user } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
const servers = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function start({ heartbeatMs = 20 } = {}) {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const bus = createEventBus();
  const config = loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(40),
    LOG_LEVEL: 'silent',
  });
  const app = createApp({ config, db, eventBus: bus, sseHeartbeatMs: heartbeatMs });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const port = server.address().port;
  const agent = request.agent(app);
  const login = async (role) => {
    const res = await agent
      .post('/login')
      .type('form')
      .send({ email: `${role}@test.local`, password: PASSWORD });
    return res.headers['set-cookie'][0].split(';')[0];
  };
  return { app, bus, port, login, db };
}

/** Abre el stream SSE y acumula el texto recibido. */
function open(port, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path, headers: cookie ? { Cookie: cookie } : {} },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        const stream = {
          res,
          req,
          text: () => text,
          until: async (pattern, ms = 1500) => {
            const start = Date.now();
            while (!pattern.test(text)) {
              if (Date.now() - start > ms)
                throw new Error(`No llegó ${pattern}; recibido: ${JSON.stringify(text)}`);
              await new Promise((r) => setTimeout(r, 10));
            }
          },
          close: () => req.destroy(),
        };
        resolve(stream);
      },
    );
    req.on('error', reject);
  });
}

test('sin sesión responde 401 y no abre el stream', async () => {
  const { port } = await start();
  const res = await new Promise((resolve) =>
    http.get({ host: '127.0.0.1', port, path: '/api/v1/events' }, resolve),
  );
  assert.equal(res.statusCode, 401);
  res.resume();
});

test('cualquier rol autenticado se conecta; cabeceras SSE, retry y comentario inicial', async () => {
  const { port, login } = await start();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const stream = await open(port, '/api/v1/events', await login(role));
    assert.equal(stream.res.statusCode, 200, role);
    assert.match(stream.res.headers['content-type'], /text\/event-stream/);
    assert.match(stream.res.headers['cache-control'], /no-cache/);
    assert.match(stream.res.headers['cache-control'], /no-transform/);
    assert.equal(stream.res.headers['x-accel-buffering'], 'no');
    await stream.until(/retry: 3000/);
    stream.close();
  }
});

test('reenvía los eventos de dominio con id, event y data JSON', async () => {
  const { port, login, bus } = await start({ heartbeatMs: 10_000 });
  const stream = await open(port, '/api/v1/events', await login('viewer'));
  await stream.until(/retry: 3000/);
  const e = bus.emit('task.status_changed', { projectId: 5, sprintId: 9, taskId: 12 });
  await stream.until(/event: task\.status_changed/);
  const block = stream
    .text()
    .split('\n\n')
    .find((b) => b.includes('task.status_changed'));
  assert.match(block, new RegExp(`^id: ${e.id}\\nevent: task\\.status_changed\\ndata: `));
  const data = JSON.parse(block.split('data: ')[1]);
  assert.deepEqual(
    { type: data.type, projectId: data.projectId, sprintId: data.sprintId, taskId: data.taskId },
    {
      type: 'task.status_changed',
      projectId: 5,
      sprintId: 9,
      taskId: 12,
    },
  );
  stream.close();
});

test('heartbeat periódico para mantener viva la conexión', async () => {
  const { port, login } = await start({ heartbeatMs: 20 });
  const stream = await open(port, '/api/v1/events', await login('viewer'));
  await stream.until(/: ping\n\n[\s\S]*: ping\n\n/);
  stream.close();
});

test('filtro por proyecto: solo eventos de ese proyecto y los globales (sin projectId)', async () => {
  const { port, login, bus } = await start({ heartbeatMs: 10_000 });
  const stream = await open(port, '/api/v1/events?projectId=7', await login('viewer'));
  await stream.until(/retry: 3000/);
  bus.emit('task.updated', { projectId: 8 });
  bus.emit('task.updated', { projectId: 7 });
  bus.emit('settings.updated');
  await stream.until(/settings\.updated/);
  const events = stream
    .text()
    .split('\n\n')
    .filter((b) => b.includes('event: '));
  const projects = events.map((b) => JSON.parse(b.split('data: ')[1]).projectId);
  assert.deepEqual(projects, [7, undefined]);
  stream.close();
});

test('un projectId inválido responde 400', async () => {
  const { port, login } = await start();
  const res = await new Promise((resolve) =>
    http.get(
      { host: '127.0.0.1', port, path: '/api/v1/events?projectId=abc', headers: { Cookie: '' } },
      resolve,
    ),
  );
  assert.equal(res.statusCode, 401); // sin cookie primero se exige sesión
  res.resume();
  const cookie = await login('viewer');
  const bad = await new Promise((resolve) =>
    http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/v1/events?projectId=abc',
        headers: { Cookie: cookie },
      },
      resolve,
    ),
  );
  assert.equal(bad.statusCode, 400);
  bad.resume();
});

test('al cerrar la conexión el cliente se elimina y deja de escucharse el bus', async () => {
  const { port, login, bus } = await start();
  const before = bus.listenerCount();
  const a = await open(port, '/api/v1/events', await login('viewer'));
  const b = await open(port, '/api/v1/events', await login('pm'));
  await a.until(/retry/);
  await b.until(/retry/);
  assert.equal(bus.listenerCount(), before + 2);
  a.close();
  b.close();
  const start0 = Date.now();
  while (bus.listenerCount() !== before && Date.now() - start0 < 1500)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(bus.listenerCount(), before);
});

test('closeAll termina las conexiones abiertas (apagado ordenado)', async () => {
  const { app, port, login } = await start();
  const stream = await open(port, '/api/v1/events', await login('viewer'));
  await stream.until(/retry/);
  const ended = new Promise((resolve) => stream.res.on('end', resolve));
  app.locals.sse.closeAll();
  await ended;
  assert.equal(app.locals.sse.clientCount(), 0);
});
