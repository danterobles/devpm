import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { createMailer } from '../../src/lib/mailer.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, assignment, timeEntry } from '../helpers/factories.js';

// Notificaciones (RF-100 a RF-104): API, páginas, avisos por evento y correo.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup({ mailer = null } = {}) {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const ids = {
    admin: user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' }),
    lead: user(db, {
      email: 'lead@test.local',
      password_hash: hash,
      role: 'pm',
      team_member_id: lead,
    }),
    dev: user(db, {
      email: 'dev@test.local',
      password_hash: hash,
      role: 'developer',
      team_member_id: dev,
    }),
    viewer: user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' }),
  };
  const pid = project(db, {
    code: 'PRJ-1',
    manager_id: lead,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  for (const m of [dev, lead])
    assignment(db, {
      project_id: pid,
      team_member_id: m,
      start_date: '2026-03-01',
      end_date: '2026-06-30',
    });
  const app = buildTestApp({ db, mailer });
  return { db, app, pid, dev, lead, ids };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
const rows = (db, userId) =>
  db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id').all(userId);
const mk = (db, userId, o = {}) =>
  db
    .prepare(
      'INSERT INTO notifications (user_id, type, title, body, link, dedupe_key) VALUES (?,?,?,?,?,?)',
    )
    .run(
      userId,
      o.type ?? 'task_assigned',
      o.title ?? 'Aviso',
      o.body ?? 'Detalle',
      o.link ?? null,
      o.key ?? null,
    ).lastInsertRowid;

test('permisos: sin sesión 401 en la API y redirección en las páginas', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/notifications')).status, 401);
  assert.equal((await request(app).get('/api/v1/notifications/unread-count')).status, 401);
  assert.equal((await request(app).post('/api/v1/notifications/read-all')).status, 401);
  assert.equal((await request(app).get('/notifications')).headers.location, '/login');
});

test('cada persona solo ve y modifica sus propias notificaciones', async () => {
  const { app, db, ids } = setup();
  const mine = mk(db, ids.dev, { title: 'Mía' });
  const theirs = mk(db, ids.lead, { title: 'Ajena' });
  const dev = await loginAs(app, 'dev');
  const list = await dev.get('/api/v1/notifications');
  assert.deepEqual(
    list.body.data.map((n) => n.title),
    ['Mía'],
  );
  assert.equal((await dev.get('/api/v1/notifications/unread-count')).body.data.unread, 1);
  assert.equal((await dev.post(`/api/v1/notifications/${theirs}/read`)).status, 404);
  assert.equal(
    db.prepare('SELECT read_at FROM notifications WHERE id = ?').pluck().get(theirs),
    null,
  );
  const read = await dev.post(`/api/v1/notifications/${mine}/read`);
  assert.equal(read.body.data.isRead, true);
  assert.equal((await dev.get('/api/v1/notifications/unread-count')).body.data.unread, 0);
  assert.equal((await dev.post('/api/v1/notifications/abc/read')).status, 404);
});

test('marcar todas como leídas y filtro de sin leer', async () => {
  const { app, db, ids } = setup();
  mk(db, ids.dev);
  mk(db, ids.dev);
  const dev = await loginAs(app, 'dev');
  assert.equal((await dev.get('/api/v1/notifications?unread=1')).body.meta.total, 2);
  assert.equal((await dev.post('/api/v1/notifications/read-all')).body.data.updated, 2);
  assert.equal((await dev.get('/api/v1/notifications?unread=1')).body.meta.total, 0);
  assert.equal((await dev.get('/api/v1/notifications')).body.meta.total, 2);
  assert.equal((await dev.get('/api/v1/notifications?pageSize=500')).status, 400);
});

test('la página lista las notificaciones, abre una (la marca leída) y solo redirige a enlaces internos', async () => {
  const { app, db, ids } = setup();
  const internal = mk(db, ids.dev, { title: 'Interna', link: '/projects' });
  const external = mk(db, ids.dev, { title: 'Externa', link: 'https://evil.example/x' });
  const dev = await loginAs(app, 'dev');
  const page = await dev.get('/notifications');
  assert.equal(page.status, 200);
  assert.match(page.text, /Interna/);
  assert.match(page.text, /2 sin leer/);
  const go = await dev.post(`/notifications/${internal}/open`);
  assert.equal(go.headers.location, '/projects');
  assert.equal(
    (await dev.post(`/notifications/${external}/open`)).headers.location,
    '/notifications',
  );
  assert.equal((await dev.get('/notifications?unread=1')).text.includes('Interna'), false);
  await dev.post('/notifications/read-all');
  assert.equal(
    db.prepare('SELECT count(*) FROM notifications WHERE read_at IS NULL').pluck().get(),
    0,
  );
});

test('el título y el detalle se escapan (XSS)', async () => {
  const { app, db, ids } = setup();
  mk(db, ids.dev, { title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>' });
  const html = (await (await loginAs(app, 'dev')).get('/notifications')).text;
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('el encabezado muestra la campana con el contador de no leídas', async () => {
  const { app, db, ids } = setup();
  mk(db, ids.dev);
  const html = (await (await loginAs(app, 'dev')).get('/projects')).text;
  assert.match(html, /data-notification-bell[^>]*aria-label="Notificaciones, 1 sin leer"/);
  assert.match(html, /\/js\/lib\/notifications\.js/);
});

test('preferencias: el correo se puede desactivar y reactivar', async () => {
  const { app, db, ids } = setup();
  const dev = await loginAs(app, 'dev');
  assert.match((await dev.get('/account/notifications')).text, /checked/);
  await dev.post('/account/notifications').type('form').send({});
  assert.equal(
    db.prepare('SELECT email_notifications FROM users WHERE id = ?').pluck().get(ids.dev),
    0,
  );
  const page = await dev.get('/account/notifications?saved=1');
  assert.match(page.text, /Preferencias guardadas/);
  assert.doesNotMatch(page.text.match(/<input type="checkbox"[^>]*>/)[0], /checked/);
  await dev.post('/account/notifications').type('form').send({ emailNotifications: '1' });
  assert.equal(
    db.prepare('SELECT email_notifications FROM users WHERE id = ?').pluck().get(ids.dev),
    1,
  );
});

test('horas: al enviar se avisa al líder; al aprobar o rechazar, al autor (con el motivo)', async () => {
  const { app, db, pid, dev, ids } = setup();
  const a = timeEntry(db, {
    team_member_id: dev,
    project_id: pid,
    work_date: '2026-05-11',
    minutes: 90,
  });
  const b = timeEntry(db, {
    team_member_id: dev,
    project_id: pid,
    work_date: '2026-05-12',
    minutes: 60,
  });
  const devA = await loginAs(app, 'dev');
  const lead = await loginAs(app, 'lead');
  await devA.post(`/api/v1/time-entries/${a}/submit`).send({});
  await devA.post('/api/v1/time-entries/submit-week').send({ week: '2026-05-13' });
  const toLead = rows(db, ids.lead);
  assert.equal(toLead.length, 1, 'un solo aviso por proyecto y día (deduplicado)');
  assert.equal(toLead[0].type, 'hours_to_review');
  assert.match(toLead[0].body, /Ana Ruiz envió horas de PRJ-1/);
  assert.equal(toLead[0].link, '/time/approvals');
  assert.equal(rows(db, ids.dev).length, 0, 'el autor no recibe aviso de su propio envío');

  await lead.post(`/api/v1/time-entries/${a}/approve`).send({});
  await lead.post(`/api/v1/time-entries/${b}/reject`).send({ reason: 'falta detalle' });
  const toDev = rows(db, ids.dev);
  assert.deepEqual(
    toDev.map((n) => n.type),
    ['hours_approved', 'hours_rejected'],
  );
  assert.match(toDev[0].body, /PRJ-1 · 2026-05-11 · 1\.5 h/);
  assert.match(toDev[1].body, /Motivo: falta detalle/);
  assert.equal(rows(db, ids.lead).length, 1, 'quien revisa no se avisa a sí mismo');
});

test('horas: sin usuario vinculado al líder, el aviso va a los administradores', async () => {
  const { app, db, pid, dev, ids } = setup();
  const solo = project(db, { code: 'PRJ-2', start_date: '2026-01-05', end_date: '2026-12-18' }); // sin líder
  assignment(db, {
    project_id: solo,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-06-30',
  });
  const e = timeEntry(db, { team_member_id: dev, project_id: solo, work_date: '2026-05-11' });
  await (await loginAs(app, 'dev')).post(`/api/v1/time-entries/${e}/submit`).send({});
  assert.equal(rows(db, ids.admin).length, 1);
  assert.equal(rows(db, ids.lead).length, 0);
  assert.ok(pid);
});

test('tareas: se avisa al responsable al asignar o reasignar (no si se la asigna uno mismo) y al líder si se bloquea', async () => {
  const { app, db, pid, dev, lead, ids } = setup();
  const lead1 = await loginAs(app, 'lead');
  const created = await lead1
    .post(`/api/v1/projects/${pid}/tasks`)
    .send({ title: 'Diseñar modelo', assigneeId: dev });
  assert.equal(created.status, 201);
  const taskId = created.body.data.id;
  let toDev = rows(db, ids.dev);
  assert.equal(toDev.length, 1);
  assert.equal(toDev[0].type, 'task_assigned');
  assert.equal(toDev[0].link, `/tasks/${taskId}`);
  assert.match(toDev[0].body, /Diseñar modelo/);

  // reasignar a la líder (que lo hace): sin aviso para ella misma
  await lead1.patch(`/api/v1/tasks/${taskId}`).send({ assigneeId: lead });
  assert.equal(rows(db, ids.lead).length, 0);
  // reasignar al developer otra vez: nuevo aviso
  await lead1.patch(`/api/v1/tasks/${taskId}`).send({ assigneeId: dev });
  assert.equal(rows(db, ids.dev).length, 2);
  // editar sin cambiar el responsable no avisa
  await lead1.patch(`/api/v1/tasks/${taskId}`).send({ title: 'Diseñar el modelo' });
  assert.equal(rows(db, ids.dev).length, 2);

  // bloqueo por el developer: avisa a la líder
  const dev1 = await loginAs(app, 'dev');
  await dev1.post(`/api/v1/tasks/${taskId}/status`).send({ status: 'todo' });
  await dev1.post(`/api/v1/tasks/${taskId}/status`).send({ status: 'blocked' });
  const toLead = rows(db, ids.lead);
  assert.equal(toLead.length, 1);
  assert.equal(toLead[0].type, 'task_blocked');
});

test('correo: se envía copia a quien lo tiene activado y no a quien lo desactivó', async () => {
  const sent = [];
  const mailer = createMailer({
    smtp: { from: 'DevPM <no-reply@test>' },
    transport: { sendMail: async (m) => sent.push(m) },
  });
  const { app, db, pid, dev, ids } = setup({ mailer });
  const e = timeEntry(db, { team_member_id: dev, project_id: pid, work_date: '2026-05-11' });
  const lead = await loginAs(app, 'lead');
  await (await loginAs(app, 'dev')).post(`/api/v1/time-entries/${e}/submit`).send({});
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'lead@test.local');
  assert.equal(sent[0].subject, '[DevPM] Horas por aprobar');
  assert.match(sent[0].text, /Ana Ruiz envió horas de PRJ-1/);
  assert.match(sent[0].text, /http:\/\/localhost:3000\/time\/approvals/);

  db.prepare('UPDATE users SET email_notifications = 0 WHERE id = ?').run(ids.dev);
  await lead.post(`/api/v1/time-entries/${e}/approve`).send({});
  await new Promise((r) => setImmediate(r));
  assert.equal(
    sent.length,
    1,
    'con el correo desactivado solo queda el aviso dentro de la aplicación',
  );
  assert.equal(rows(db, ids.dev).length, 1);
});

test('correo: un fallo de envío no interrumpe la operación ni quita el aviso', async () => {
  const mailer = createMailer({
    smtp: { from: 'x' },
    transport: {
      sendMail: async () => {
        throw new Error('SMTP caído');
      },
    },
  });
  const { app, db, pid, dev, ids } = setup({ mailer });
  const e = timeEntry(db, { team_member_id: dev, project_id: pid, work_date: '2026-05-11' });
  const res = await (await loginAs(app, 'dev')).post(`/api/v1/time-entries/${e}/submit`).send({});
  assert.equal(res.status, 200);
  await new Promise((r) => setImmediate(r));
  assert.equal(rows(db, ids.lead).length, 1);
});

test('sin SMTP el mailer queda deshabilitado y no envía nada', async () => {
  const mailer = createMailer({ smtp: { host: null } });
  assert.equal(mailer.enabled, false);
  assert.equal(await mailer.send({ to: 'a@b.co', subject: 's', text: 't' }), false);
});

test('se eliminan las notificaciones leídas con más de 90 días', async () => {
  const { app, db, ids } = setup();
  const old = mk(db, ids.dev, { title: 'Vieja' });
  const recent = mk(db, ids.dev, { title: 'Reciente' });
  const unread = mk(db, ids.dev, { title: 'Sin leer' });
  db.prepare("UPDATE notifications SET read_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(old);
  db.prepare("UPDATE notifications SET read_at = '2026-05-01T00:00:00.000Z' WHERE id = ?").run(
    recent,
  );
  const removed = app.locals.notifications.prune('2026-05-13');
  assert.equal(removed, 1);
  assert.deepEqual(db.prepare('SELECT id FROM notifications ORDER BY id').pluck().all(), [
    recent,
    unread,
  ]);
});

// ---- Preferencias por tipo de aviso (RF-180) ----

test('preferencias por tipo: la página lista los 12 tipos con sus casillas marcadas por omisión', async () => {
  const { app } = setup();
  const html = (await (await loginAs(app, 'dev')).get('/account/notifications')).text;
  for (const type of ['hours_to_review', 'task_mention', 'project_at_risk', 'hours_midweek'])
    assert.match(html, new RegExp(`name="in_${type}" value="1" class="h-5 w-5" checked`), type);
  assert.equal((html.match(/name="mail_/g) ?? []).length, 12);
  assert.match(html, /<th scope="col"[^>]*>En la aplicación/);
});

test('preferencias por tipo: desactivar un tipo en la aplicación evita el aviso y desactivar ambos lo evita por completo', async () => {
  const sent = [];
  const mailer = createMailer({
    smtp: { from: 'x' },
    transport: { sendMail: async (m) => sent.push(m) },
  });
  const { app, db, ids } = setup({ mailer });
  const dev = await loginAs(app, 'dev');
  const notify = (type, key) =>
    app.locals.notifications.notify({
      userIds: [ids.dev],
      type,
      title: `T ${type}`,
      body: 'b',
      dedupeKey: key,
    });
  // «Horas rechazadas»: ni en la aplicación ni por correo; «Tarea asignada»: solo por correo
  const keep = Object.fromEntries(
    [
      'hours_midweek',
      'hours_close',
      'hours_to_review',
      'hours_approved',
      'task_comment',
      'task_mention',
      'task_overdue',
      'task_blocked',
      'milestone_overdue',
      'project_at_risk',
    ].flatMap((t) => [
      [`in_${t}`, '1'],
      [`mail_${t}`, '1'],
    ]),
  );
  await dev
    .post('/account/notifications')
    .type('form')
    .send({ emailNotifications: '1', ...keep, mail_task_assigned: '1' });
  assert.equal(notify('hours_rejected', 'a'), 0, 'sin aviso alguno');
  assert.equal(rows(db, ids.dev).length, 0);
  assert.equal(notify('task_assigned', 'b'), 1);
  const row = rows(db, ids.dev)[0];
  assert.notEqual(row.read_at, null, 'solo por correo: queda como leído');
  assert.equal((await dev.get('/api/v1/notifications/unread-count')).body.data.unread, 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1, 'el correo sí se envía');
  assert.equal(notify('task_assigned', 'b'), 0, 'la deduplicación sigue funcionando');
  assert.equal(notify('hours_approved', 'c'), 1);
  assert.equal((await dev.get('/api/v1/notifications/unread-count')).body.data.unread, 1);
});

test('preferencias por tipo: solo se guardan las que se apartan del valor por omisión y se pueden restablecer', async () => {
  const { app, db, ids } = setup();
  const dev = await loginAs(app, 'dev');
  await dev.post('/account/notifications').type('form').send({ emailNotifications: '1' }); // todo desmarcado
  assert.equal(
    db
      .prepare('SELECT count(*) FROM notification_preferences WHERE user_id = ?')
      .pluck()
      .get(ids.dev),
    12,
  );
  const all = {};
  for (const t of db.prepare('SELECT type FROM notification_preferences').pluck().all()) {
    all[`in_${t}`] = '1';
    all[`mail_${t}`] = '1';
  }
  await dev
    .post('/account/notifications')
    .type('form')
    .send({ emailNotifications: '1', ...all });
  assert.equal(db.prepare('SELECT count(*) FROM notification_preferences').pluck().get(), 0);
});

test('preferencias por tipo: cada persona tiene las suyas y los tipos inventados se ignoran', async () => {
  const { app, db, ids } = setup();
  await (
    await loginAs(app, 'dev')
  )
    .post('/account/notifications')
    .type('form')
    .send({ in_inventado: '1', mail_inventado: '1' });
  assert.equal(
    db
      .prepare("SELECT count(*) FROM notification_preferences WHERE type = 'inventado'")
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    db
      .prepare('SELECT count(*) FROM notification_preferences WHERE user_id = ?')
      .pluck()
      .get(ids.lead),
    0,
  );
  assert.equal(
    app.locals.notifications.notify({
      userIds: [ids.lead],
      type: 'task_assigned',
      title: 't',
      body: 'b',
    }),
    1,
  );
});
