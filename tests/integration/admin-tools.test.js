import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp, testConfig } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user } from '../helpers/factories.js';

// Bitácora, eventos de seguridad y estado del sistema (RF-170 a RF-172).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup(overrides = {}) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpm-adm-'));
  const db = createTestDb();
  const ids = {};
  for (const role of ['admin', 'pm', 'developer', 'viewer'])
    ids[role] = user(db, {
      email: `${role}@t.local`,
      password_hash: hash,
      role,
      full_name: `Persona ${role}`,
    });
  const app = buildTestApp({ db, config: testConfig({ BACKUP_DIR: backupDir, ...overrides }) });
  return {
    db,
    app,
    ids,
    backupDir,
    cleanup: () => fs.rmSync(backupDir, { recursive: true, force: true }),
  };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}
const PAGES = ['/admin/audit', '/admin/security', '/admin/status'];
const APIS = ['/api/v1/audit', '/api/v1/security-events', '/api/v1/status'];

test('solo el administrador entra a la bitácora, la seguridad y el estado', async () => {
  const { app, cleanup } = setup();
  for (const url of PAGES)
    assert.equal((await request(app).get(url)).headers.location, '/login', url);
  for (const url of APIS) assert.equal((await request(app).get(url)).status, 401, url);
  for (const who of ['pm', 'developer', 'viewer']) {
    const agent = await loginAs(app, who);
    for (const url of [...PAGES, ...APIS])
      assert.equal((await agent.get(url)).status, 403, `${who} ${url}`);
  }
  const admin = await loginAs(app, 'admin');
  for (const url of [...PAGES, ...APIS]) assert.equal((await admin.get(url)).status, 200, url);
  cleanup();
});

test('bitácora: lista altas y cambios con «antes → después» y sin mostrar secretos', async () => {
  const { app, db, cleanup } = setup();
  const admin = await loginAs(app, 'admin');
  const created = await admin
    .post('/api/v1/clients')
    .send({ type: 'internal', name: 'Finanzas', department: 'Contabilidad' });
  await admin.patch(`/api/v1/clients/${created.body.data.id}`).send({ name: 'Finanzas MX' });
  await admin.post('/api/v1/users').send({
    email: 'nuevo@t.local',
    fullName: 'Nuevo',
    role: 'viewer',
    password: 'ClaveSecreta2026',
  });
  const newUser = db.prepare("SELECT id FROM users WHERE email = 'nuevo@t.local'").pluck().get();
  await admin.patch(`/api/v1/users/${newUser}`).send({ password: 'OtraClave2026' });
  const html = (await admin.get('/admin/audit')).text;
  assert.match(html, /Cliente <span[^>]*>#\d+/);
  assert.match(html, /Alta/);
  assert.match(html, /Cambio/);
  assert.match(html, /name<\/span>: <span[^>]*>Finanzas<\/span> → Finanzas MX/);
  assert.match(html, /Persona admin/);
  assert.doesNotMatch(html, /ClaveSecreta2026|OtraClave2026/);
  assert.match(html, /\(oculto\)/, 'los campos de contraseña no muestran su valor');
  const json = (await admin.get('/api/v1/audit')).body;
  assert.ok(json.meta.total >= 3);
  assert.doesNotMatch(JSON.stringify(json), /ClaveSecreta2026|OtraClave2026|\$2[aby]\$/);
  assert.ok(db.prepare('SELECT count(*) FROM audit_log').pluck().get() >= 3);
  cleanup();
});

test('bitácora: filtros por entidad, acción, usuario y fechas; paginación; valores inválidos = 400', async () => {
  const { app, db, ids, cleanup } = setup();
  const log = (entity, action, userId, at) =>
    db
      .prepare(
        'INSERT INTO audit_log (user_id, entity, entity_id, action, changes, created_at) VALUES (?, ?, 1, ?, ?, ?)',
      )
      .run(userId, entity, action, '{"nombre":["a","b"]}', at);
  log('project', 'create', ids.admin, '2026-05-01T10:00:00.000Z');
  log('project', 'update', ids.pm, '2026-05-10T10:00:00.000Z');
  log('task', 'delete', ids.pm, '2026-05-12T10:00:00.000Z');
  for (let i = 0; i < 60; i += 1) log('client', 'update', ids.admin, '2026-04-01T10:00:00.000Z');
  const admin = await loginAs(app, 'admin');
  const q = async (qs) => (await admin.get(`/api/v1/audit${qs}`)).body;
  assert.equal((await q('?entity=project')).meta.total, 2);
  assert.equal((await q('?action=delete')).meta.total, 1);
  assert.equal((await q(`?userId=${ids.pm}`)).meta.total, 2);
  assert.equal((await q('?from=2026-05-05&to=2026-05-11')).meta.total, 1);
  assert.equal((await q('?entity=project&action=update')).data[0].entityLabel, 'Proyecto');
  const page1 = await q('');
  assert.equal(page1.data.length, 50);
  assert.equal(page1.meta.total, 63);
  assert.equal((await q('?page=2')).data.length, 13);
  assert.ok(page1.data[0].id > page1.data[1].id, 'lo más reciente primero');
  for (const bad of ['?userId=abc', '?action=otra', '?from=ayer', '?pageSize=500', '?page=0'])
    assert.equal((await admin.get(`/api/v1/audit${bad}`)).status, 400, bad);
  assert.match(
    (await admin.get('/admin/audit?entity=project')).text,
    /Mostrando|2 registros|<option value="project" selected>/,
  );
  assert.equal((await admin.get('/admin/audit?entity=')).status, 200, 'un filtro vacío se ignora');
  cleanup();
});

test('bitácora: escapa el contenido y oculta los campos sensibles', async () => {
  const { app, db, ids, cleanup } = setup();
  db.prepare(
    "INSERT INTO audit_log (user_id, entity, entity_id, action, changes) VALUES (?, 'client', 1, 'update', ?)",
  ).run(ids.admin, '{"name":["<script>alert(1)</script>","x"]}');
  db.prepare(
    "INSERT INTO audit_log (user_id, entity, entity_id, action, changes) VALUES (?, 'user', 3, 'update', ?)",
  ).run(
    ids.admin,
    '{"password":[null,"(cambiada)"],"totp_secret":["A","B"],"role":["viewer","pm"]}',
  );
  const html = (await (await loginAs(app, 'admin')).get('/admin/audit')).text;
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /role<\/span>: <span[^>]*>viewer<\/span> → pm/);
  assert.doesNotMatch(html, /\(cambiada\)/);
  cleanup();
});

test('seguridad: muestra los eventos, con filtros por tipo, correo o IP y fechas', async () => {
  const { app, db, cleanup } = setup();
  await request(app)
    .post('/login')
    .type('form')
    .send({ email: 'viewer@t.local', password: 'mala' });
  await request(app).post('/login').type('form').send({ email: 'pm@t.local', password: PASSWORD });
  const admin = await loginAs(app, 'admin');
  const html = (await admin.get('/admin/security')).text;
  assert.match(html, /Inicio de sesión fallido/);
  assert.match(html, /viewer@t\.local/);
  assert.doesNotMatch(html, /mala/);
  const q = async (qs) => (await admin.get(`/api/v1/security-events${qs}`)).body;
  assert.equal((await q('?type=login_failed')).meta.total, 1);
  assert.ok((await q('?type=login_success')).meta.total >= 2);
  assert.equal((await q('?q=viewer@')).meta.total, 1);
  assert.equal((await q('?q=%25')).meta.total, 0, 'el texto de búsqueda es literal');
  assert.equal((await q('?from=2999-01-01')).meta.total, 0);
  assert.equal((await q('?type=inventado')).status, undefined);
  assert.equal((await admin.get('/api/v1/security-events?type=inventado')).status, 400);
  db.prepare("INSERT INTO security_events (type, email) VALUES ('login_failed', ?)").run(
    '<img src=x onerror=alert(1)>',
  );
  assert.doesNotMatch((await admin.get('/admin/security')).text, /<img src=x/);
  cleanup();
});

test('seguridad: los eventos de más de 90 días se eliminan', async () => {
  const { app, db, cleanup } = setup();
  db.prepare(
    "INSERT INTO security_events (type, created_at) VALUES ('login_failed', '2026-01-01T00:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO security_events (type, created_at) VALUES ('login_failed', '2026-05-01T00:00:00.000Z')",
  ).run();
  const removed = app.locals.securityEvents.prune('2026-05-13');
  assert.equal(removed, 1);
  assert.equal(db.prepare('SELECT count(*) FROM security_events').pluck().get(), 1);
  cleanup();
});

test('estado: datos del sistema, métricas de solicitudes y alerta por falta de respaldos', async () => {
  const { app, cleanup, backupDir } = setup();
  const admin = await loginAs(app, 'admin');
  await admin.get('/api/v1/clients');
  await admin.get('/api/v1/clients/abc'); // 4xx
  const s = (await admin.get('/api/v1/status')).body.data;
  assert.match(s.version, /^\d+\.\d+\.\d+$/);
  assert.equal(s.database.ok, true);
  assert.ok(s.database.migrations >= 7);
  assert.equal(s.database.counts.users, 4);
  assert.ok(s.requests.recentRequests >= 3);
  assert.ok(s.requests.recentClientErrors >= 1);
  assert.equal(typeof s.requests.p95Ms, 'number');
  assert.equal(s.mail.configured, false);
  assert.equal(s.liveConnections, 0);
  assert.match(JSON.stringify(s.alerts), /No hay respaldos/);
  const html = (await admin.get('/admin/status')).text;
  assert.match(html, /Estado del sistema/);
  assert.match(html, /data-status-alerts/);
  assert.match(html, /No hay respaldos/);
  assert.match(html, /Latencia p95/);
  fs.writeFileSync(path.join(backupDir, 'devpm-20260513-0200.db'), 'x');
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const after = (await admin.get('/api/v1/status')).body.data;
  assert.equal(after.backup.last.name, 'devpm-20260513-0200.db');
  assert.doesNotMatch(JSON.stringify(after.alerts), /No hay respaldos/);
  cleanup();
});

test('estado: los estáticos y las conexiones en vivo no cuentan como solicitudes', async () => {
  const { app, cleanup } = setup();
  const admin = await loginAs(app, 'admin');
  const before = (await admin.get('/api/v1/status')).body.data.requests.totalRequests;
  for (let i = 0; i < 5; i += 1) await request(app).get('/js/lib/theme.js');
  const after = (await admin.get('/api/v1/status')).body.data.requests.totalRequests;
  assert.equal(after - before, 1, 'solo cuenta la propia consulta anterior');
  cleanup();
});

test('la administración tiene su navegación (usuarios, bitácora, seguridad, estado y umbrales)', async () => {
  const { app, cleanup } = setup();
  const admin = await loginAs(app, 'admin');
  for (const [url, current] of [
    ['/admin/users', 'Usuarios'],
    ['/admin/audit', 'Bitácora'],
    ['/admin/security', 'Seguridad'],
    ['/admin/status', 'Estado'],
    ['/admin/settings/kpis', 'Umbrales de KPIs'],
  ]) {
    const html = (await admin.get(url)).text;
    assert.match(html, /aria-label="Administración"/, url);
    assert.match(html, new RegExp(`aria-current="page"[^>]*>${current}</a>`), url);
    for (const href of [
      '/admin/users',
      '/admin/audit',
      '/admin/security',
      '/admin/status',
      '/admin/settings/kpis',
    ])
      assert.match(html, new RegExp(`href="${href}"`), `${url} → ${href}`);
  }
  cleanup();
});

test('los avisos periódicos dejan registrada su última ejecución para la pantalla de estado', async () => {
  const { app, cleanup } = setup();
  const admin = await loginAs(app, 'admin');
  assert.equal((await admin.get('/api/v1/status')).body.data.reminders, null);
  app.locals.reminders.run('2026-05-13');
  const r = (await admin.get('/api/v1/status')).body.data.reminders;
  assert.ok(r.at);
  assert.equal(typeof r.counts.hours, 'number');
  assert.match((await admin.get('/admin/status')).text, /Última ejecución/);
  cleanup();
});
