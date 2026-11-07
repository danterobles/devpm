import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import express from 'express';
import request from 'supertest';
import { loadConfig } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';
import { buildTestApp, testConfig } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user } from '../helpers/factories.js';

// Revisión de seguridad (ARQUITECTURA §7, RNF-04 y RNF-05).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
const PUBLIC = new Set([
  '/health',
  '/login',
  '/logout',
  '/login/2fa',
  '/forgot-password',
  '/reset-password',
  '/favicon.ico', // redirige al ícono SVG (estático)
]);

function setup(config = testConfig()) {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  return { db, app: createApp({ config, db }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}

// Para conocer el prefijo con el que se monta cada sub-router se registra `router.use('/prefijo', hijo)`.
const mounts = new Map();
const proto = Object.getPrototypeOf(express.Router());
const originalUse = proto.use;
proto.use = function use(...args) {
  const [first, ...rest] = args;
  if (typeof first === 'string')
    for (const handler of rest.flat()) if (handler?.stack) mounts.set(handler, first);
  return originalUse.apply(this, args);
};
after(() => {
  proto.use = originalUse;
});

/** Todas las rutas (método + ruta completa) de la aplicación, incluidos los sub-routers con prefijo. */
function allRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods))
          out.push({ method, path: prefix + layer.route.path });
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix + (mounts.get(layer.handle) ?? ''));
      }
    }
  };
  walk(app.router.stack, '');
  return out;
}

test('autorización global: sin sesión TODA ruta registrada exige iniciar sesión (salvo /health, el inicio de sesión y la recuperación de contraseña)', async () => {
  const { app } = setup();
  const routes = allRoutes(app).filter((r) => !PUBLIC.has(r.path));
  assert.ok(routes.length > 120, `se recorrieron ${routes.length} rutas`);
  const unprotected = [];
  for (const { method, path } of routes) {
    const url = path.replaceAll(/:\w+/g, '1');
    const res = await request(app)[method](url).send({});
    if (![302, 401].includes(res.status))
      unprotected.push(`${method.toUpperCase()} ${path} → ${res.status}`);
    if (url.startsWith('/api/')) assert.equal(res.status, 401, `${method} ${url}`);
    else assert.equal(res.headers.location, '/login', `${method} ${url}`);
  }
  assert.deepEqual(unprotected, []);
});

test('rutas inexistentes y estáticos: una ruta desconocida no revela nada sin sesión; los estáticos son públicos', async () => {
  const { app } = setup();
  const unknown = await request(app).get('/no-existe');
  assert.equal(unknown.status, 302);
  assert.equal(unknown.headers.location, '/login');
  assert.equal((await request(app).get('/api/v1/no-existe')).status, 401);
  assert.equal((await request(app).get('/js/lib/live.js')).status, 200);
  assert.equal((await (await loginAs(app, 'viewer')).get('/no-existe')).status, 404);
});

test('/health sigue siendo público y no expone datos sensibles', async () => {
  const { app } = setup();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['db', 'status', 'uptime']);
});

test('CSP: sin CDNs ni scripts en línea; solo orígenes propios', async () => {
  const { app } = setup();
  const csp = (await request(app).get('/health')).headers['content-security-policy'];
  const dir = Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+(.*)/s))
      .map(([k, v]) => [k, v]),
  );
  assert.equal(dir['default-src'], "'self'");
  assert.equal(dir['script-src'], "'self'"); // sin 'unsafe-inline' ni 'unsafe-eval'
  assert.equal(dir['object-src'], "'none'");
  assert.equal(dir['frame-ancestors'], "'none'");
  assert.equal(dir['connect-src'], "'self'");
  assert.doesNotMatch(csp, /https?:\/\//); // ningún origen externo
  assert.doesNotMatch(dir['script-src'], /unsafe/);
});

test('cabeceras de seguridad en todas las respuestas', async () => {
  const { app } = setup();
  const h = (await request(app).get('/health')).headers;
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['referrer-policy'], 'same-origin');
  assert.equal(h['x-frame-options'], 'SAMEORIGIN');
  assert.equal(h['x-powered-by'], undefined);
  assert.equal(h['cross-origin-opener-policy'], 'same-origin');
});

test('HSTS y upgrade-insecure-requests solo en producción (en HTTP plano romperían los recursos)', async () => {
  const dev = (await request(setup().app).get('/health')).headers;
  assert.equal(dev['strict-transport-security'], undefined);
  assert.doesNotMatch(dev['content-security-policy'], /upgrade-insecure-requests/);
  const prod = setup(
    loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40), LOG_LEVEL: 'silent' }),
  );
  const res = await request(prod.app).get('/health').set('X-Forwarded-Proto', 'https');
  assert.match(res.headers['strict-transport-security'], /max-age=\d+/);
  assert.match(res.headers['content-security-policy'], /upgrade-insecure-requests/);
});

test('cookie de sesión: HttpOnly, SameSite=Strict, nombre propio y Secure en producción', async () => {
  const login = async (config) => {
    const { app } = setup(config);
    const agent = request.agent(app);
    return agent
      .post('/login')
      .set('X-Forwarded-Proto', 'https')
      .type('form')
      .send({ email: 'viewer@test.local', password: PASSWORD });
  };
  const dev = (await login(testConfig())).headers['set-cookie'][0];
  assert.match(dev, /^devpm\.sid=/);
  assert.doesNotMatch(dev, /connect\.sid/);
  assert.match(dev, /HttpOnly/);
  assert.match(dev, /SameSite=Strict/);
  assert.doesNotMatch(dev, /Secure/);
  const prod = (
    await login(
      loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40), LOG_LEVEL: 'silent' }),
    )
  ).headers['set-cookie'][0];
  assert.match(prod, /Secure/);
});

test('el ID de sesión cambia al iniciar sesión (sin fijación de sesión)', async () => {
  const { app } = setup();
  const agent = request.agent(app);
  const anon = await agent.get('/login');
  assert.equal(anon.headers['set-cookie'], undefined); // visitante sin cookie
  const first = await agent
    .post('/login')
    .type('form')
    .send({ email: 'viewer@test.local', password: PASSWORD });
  const sid = first.headers['set-cookie'][0].split(';')[0];
  await agent.post('/logout').type('form').send({});
  const again = await agent
    .post('/login')
    .type('form')
    .send({ email: 'viewer@test.local', password: PASSWORD });
  assert.notEqual(again.headers['set-cookie'][0].split(';')[0], sid);
});

test('CSRF: un POST con Origin ajeno o nulo se rechaza aun con sesión válida', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin');
  const body = { type: 'internal', name: 'Atacante', department: 'X' };
  for (const origin of ['https://evil.example', 'null']) {
    const res = await admin.post('/api/v1/clients').set('Origin', origin).send(body);
    assert.equal(res.status, 403, origin);
  }
  assert.equal(db.prepare("SELECT count(*) FROM clients WHERE name = 'Atacante'").pluck().get(), 0);
});

test('XSS: el contenido de los usuarios se escapa en las vistas', async () => {
  const { app } = setup();
  const admin = await loginAs(app, 'admin');
  const payload = '<script>alert(1)</script>';
  await admin
    .post('/api/v1/clients')
    .send({ type: 'internal', name: payload, department: '"><img src=x onerror=alert(1)>' });
  const list = await admin.get('/clients/internal');
  assert.doesNotMatch(list.text, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(list.text, /<img src=x/);
  assert.match(list.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('inyección SQL: los parámetros de búsqueda y filtros no alteran las consultas', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin');
  const evil = "'; DROP TABLE clients; --";
  assert.equal((await admin.get('/api/v1/clients').query({ q: evil })).status, 200);
  assert.equal((await admin.get('/api/v1/projects').query({ q: evil })).status, 200);
  assert.equal((await admin.get('/api/v1/team-members').query({ q: evil })).status, 200);
  assert.equal((await admin.get('/api/v1/users').query({ q: evil })).status, 200);
  assert.equal((await admin.get('/api/v1/clients?status=' + encodeURIComponent(evil))).status, 400);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'clients'").get());
});

test('las respuestas de error no filtran detalles internos ni trazas', async () => {
  const { app } = setup();
  const viewer = await loginAs(app, 'viewer');
  const res = await viewer.get('/api/v1/clients/abc');
  assert.doesNotMatch(JSON.stringify(res.body), /SQLITE|at .*\.js|node_modules/);
  const html = await viewer.get('/projects/xyz/gantt');
  assert.doesNotMatch(html.text, /SqliteError|node_modules|at .*\.js:\d+/);
});

test('contraseñas: nunca se devuelven hashes en la API de usuarios', async () => {
  const { app } = setup();
  const admin = await loginAs(app, 'admin');
  const list = await admin.get('/api/v1/users');
  assert.doesNotMatch(JSON.stringify(list.body), /password|\$2[aby]\$/);
});

test('un usuario desactivado pierde el acceso de inmediato aunque tenga sesión abierta', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin');
  const viewer = await loginAs(app, 'viewer');
  assert.equal((await viewer.get('/api/v1/clients')).status, 200);
  const id = db.prepare("SELECT id FROM users WHERE email = 'viewer@test.local'").pluck().get();
  assert.equal((await admin.delete(`/api/v1/users/${id}`)).status, 204);
  assert.equal((await viewer.get('/api/v1/clients')).status, 401);
});

test('permisos por pertenencia: un developer no accede a registros de tiempo ajenos ni a la administración', async () => {
  const { app } = setup();
  const dev = await loginAs(app, 'developer');
  assert.equal((await dev.get('/api/v1/users')).status, 403);
  assert.equal((await dev.get('/admin/users')).status, 403);
  assert.equal((await dev.get('/admin/settings/kpis')).status, 403);
  assert.equal((await dev.get('/api/v1/time-entries/export.csv')).status, 403);
  assert.equal((await dev.put('/api/v1/settings/kpi-thresholds').send({})).status, 403);
});

test('sin base de datos (modo mínimo) la app arranca sin rutas protegidas ni sesiones', async () => {
  const res = await request(buildTestApp()).get('/health');
  assert.equal(res.status, 200);
});
