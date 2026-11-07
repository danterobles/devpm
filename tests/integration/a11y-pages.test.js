import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import {
  user,
  teamMember,
  externalClient,
  internalClient,
  project,
  sprint,
  task,
  assignment,
  milestone,
  timeEntry,
} from '../helpers/factories.js';

// Revisión de accesibilidad (RF-182): comprobaciones estructurales sobre TODAS las páginas, con los roles
// que las ven. Complementa los contrastes (contrast.test.js) y la navegación (accessibility.test.js).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const ids = {
    admin: user(db, { email: 'admin@t.local', password_hash: hash, role: 'admin' }),
    pm: user(db, { email: 'pm@t.local', password_hash: hash, role: 'pm', team_member_id: lead }),
    developer: user(db, {
      email: 'developer@t.local',
      password_hash: hash,
      role: 'developer',
      team_member_id: dev,
    }),
    viewer: user(db, { email: 'viewer@t.local', password_hash: hash, role: 'viewer' }),
  };
  const ext = externalClient(db, { name: 'Aurora' });
  internalClient(db, { name: 'Finanzas' });
  const pid = project(db, {
    client_id: ext,
    status: 'active',
    manager_id: lead,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  assignment(db, {
    project_id: pid,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-12-01',
  });
  const sid = sprint(db, {
    project_id: pid,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
  });
  const tid = task(db, {
    project_id: pid,
    sprint_id: sid,
    assignee_id: dev,
    status: 'todo',
    start_date: '2026-05-11',
    due_date: '2026-05-15',
  });
  task(db, { project_id: pid, title: 'En backlog' });
  milestone(db, { project_id: pid });
  timeEntry(db, {
    team_member_id: dev,
    project_id: pid,
    work_date: '2026-05-11',
    status: 'submitted',
  });
  db.prepare(
    "INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, 'Un comentario')",
  ).run(tid, ids.pm);
  db.prepare(
    "INSERT INTO task_attachments (task_id, uploaded_by, original_name, stored_name, content_type, size_bytes) VALUES (?, ?, 'a.png', ?, 'image/png', 10)",
  ).run(tid, ids.pm, 'a'.repeat(32));
  db.prepare(
    "INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, 'task_assigned', 'Aviso', 'Detalle', '/projects')",
  ).run(ids.admin);
  db.prepare(
    "INSERT INTO security_events (type, email, ip) VALUES ('login_failed', 'x@y.co', '127.0.0.1')",
  ).run();
  db.prepare(
    'INSERT INTO audit_log (user_id, entity, entity_id, action, changes) VALUES (?, \'task\', 1, \'update\', \'{"title":["a","b"]}\')',
  ).run(ids.admin);
  return { app: buildTestApp({ db }), pid, sid, tid, ext, dev };
}

/** Quita lo que no es contenido (scripts, estilos, comentarios). */
const clean = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
const text = (fragment) =>
  fragment
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .trim();
const attr = (tag, name) =>
  new RegExp(`\\s${name}=("([^"]*)"|'([^']*)')`).exec(tag)?.[2] ??
  new RegExp(`\\s${name}=("([^"]*)"|'([^']*)')`).exec(tag)?.[3] ??
  null;

function audit(url, raw) {
  const html = clean(raw);
  const bad = [];
  if (!/<html lang="es"/.test(html)) bad.push('falta <html lang="es">');
  if (!/<title>[^<]+<\/title>/.test(html)) bad.push('falta el título');
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) bad.push(`hay ${h1} <h1> (debe haber uno)`);
  if (!/<main id="contenido"/.test(html)) bad.push('falta <main id="contenido">');
  if (!/href="#contenido"/.test(html)) bad.push('falta el enlace para saltar al contenido');
  if (/tabindex="[1-9]/.test(html)) bad.push('tabindex positivo');

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) bad.push(`ids repetidos: ${[...new Set(dup)].join(', ')}`);

  // Etiquetas: <label for>, <label> que envuelve, aria-label o aria-labelledby
  const labelFor = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  const withoutWrapped = html.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g, ' LABELED ');
  for (const m of withoutWrapped.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    const type = (attr(tag, 'type') ?? 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
    const id = attr(tag, 'id');
    if (!(id && labelFor.has(id)) && !attr(tag, 'aria-label') && !attr(tag, 'aria-labelledby'))
      bad.push(`campo sin etiqueta: ${tag.slice(0, 90)}`);
  }
  for (const id of labelFor)
    if (!ids.includes(id)) bad.push(`<label for="${id}"> apunta a un id inexistente`);

  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g))
    if (!text(m[2]) && !attr(m[1], 'aria-label') && !attr(m[1], 'title'))
      bad.push(`botón sin nombre: <button${m[1].slice(0, 70)}>`);
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g))
    if (!text(m[2]) && !attr(m[1], 'aria-label') && !attr(m[1], 'title'))
      bad.push(`enlace sin nombre: <a${m[1].slice(0, 70)}>`);
  for (const m of html.matchAll(/<svg\b[^>]*>/g))
    if (!/aria-hidden="true"|role="img"/.test(m[0]))
      bad.push(`svg sin aria-hidden ni role="img": ${m[0].slice(0, 70)}`);
  for (const m of html.matchAll(/<img\b[^>]*>/g))
    if (attr(m[0], 'alt') === null) bad.push(`imagen sin alt: ${m[0].slice(0, 70)}`);
  for (const m of html.matchAll(/<th\b([^>]*)>/g))
    if (!attr(m[1], 'scope')) bad.push(`<th> sin scope: <th${m[1].slice(0, 60)}>`);
  for (const m of html.matchAll(/<table\b[\s\S]*?<\/table>/g))
    if (!/<caption/.test(m[0]) && !/aria-label/.test(m[0].slice(0, 200)))
      bad.push('tabla sin <caption>');
  // los iconos de navegación dentro de enlaces con texto «solo para lectores» siguen teniendo nombre (comprobado arriba)
  assert.deepEqual(bad, [], `${url}:\n  - ${bad.join('\n  - ')}`);
}

async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}

test('páginas públicas: acceso, recuperación y restablecimiento', async () => {
  const { app } = setup();
  for (const url of ['/login', '/forgot-password', '/reset-password?token=no']) {
    const res = await request(app).get(url);
    audit(url, res.text);
  }
});

test('todas las páginas del administrador cumplen la estructura accesible', async () => {
  const { app, pid, sid, tid, ext, dev } = setup();
  const admin = await loginAs(app, 'admin');
  const urls = [
    '/',
    '/dashboard',
    '/clients/internal',
    '/clients/external',
    '/clients/internal/new',
    '/clients/external/new',
    `/clients/external/${ext}`,
    '/team',
    '/team/new',
    `/team/${dev}`,
    '/projects',
    '/projects/new',
    `/projects/${pid}`,
    `/projects/${pid}/backlog`,
    `/projects/${pid}/backlog?type=bug`,
    `/projects/${pid}/sprints`,
    `/projects/${pid}/sprints/${sid}/board`,
    `/projects/${pid}/gantt`,
    `/projects/${pid}/sprints/${sid}/burndown`,
    `/projects/${pid}/burnup`,
    '/gantt',
    `/tasks/${tid}`,
    '/time/approvals',
    '/assignments/load',
    '/assignments/matrix',
    '/notifications',
    '/notifications?unread=1',
    '/account/notifications',
    '/account/security',
    '/account/password',
    '/search?q=ab',
    '/search',
    '/import',
    '/admin/users',
    '/admin/users/new',
    '/admin/users/2',
    '/admin/audit',
    '/admin/security',
    '/admin/status',
    '/admin/settings/kpis',
  ];
  for (const url of urls) {
    const res = await admin.get(url);
    assert.ok([200].includes(res.status), `${url} → ${res.status}`);
    audit(url, res.text);
  }
});

test('las páginas de los demás roles (líder, desarrollador y observador) también', async () => {
  const { app, pid, sid, tid } = setup();
  const common = [
    '/',
    '/dashboard',
    '/projects',
    `/projects/${pid}`,
    `/projects/${pid}/backlog`,
    `/projects/${pid}/sprints/${sid}/board`,
    `/tasks/${tid}`,
    '/search?q=ab',
    '/notifications',
    '/account/security',
    '/team',
    '/clients/internal',
  ];
  const extra = { pm: ['/time', '/time/approvals', '/import'], developer: ['/time'], viewer: [] };
  for (const [who, more] of Object.entries(extra)) {
    const agent = await loginAs(app, who);
    for (const url of [...common, ...more]) {
      const res = await agent.get(url);
      assert.equal(res.status, 200, `${who} ${url}`);
      audit(`${who} ${url}`, res.text);
    }
  }
});

test('el segundo paso del inicio de sesión y la configuración de dos pasos también son accesibles', async () => {
  const { app } = setup();
  const agent = await loginAs(app, 'developer');
  audit('setup 2fa', (await agent.post('/account/security/setup')).text);
  const page = await request(app).get('/login/2fa');
  assert.equal(page.status, 302, 'sin paso pendiente vuelve a /login');
});

test('la revisión detecta de verdad los problemas (no da por buena cualquier página)', () => {
  const page = (body) =>
    `<html lang="es"><head><title>t</title></head><body><a href="#contenido">Saltar</a><main id="contenido">${body}</main></body></html>`;
  const fails = (body, pattern) => assert.throws(() => audit('x', page(body)), pattern);
  fails('<h1>a</h1><h1>b</h1>', /2 <h1>/);
  fails('<h1>a</h1><input id="x" name="x">', /campo sin etiqueta/);
  fails('<h1>a</h1><label for="y">Y</label>', /id inexistente/);
  fails('<h1>a</h1><button type="button"></button>', /botón sin nombre/);
  fails('<h1>a</h1><a href="/x"><svg aria-hidden="true"></svg></a>', /enlace sin nombre/);
  fails('<h1>a</h1><svg></svg>', /svg sin aria-hidden/);
  fails('<h1>a</h1><img src="x.png">', /imagen sin alt/);
  fails('<h1>a</h1><table><tr><th>Col</th></tr></table>', /sin scope/);
  fails('<h1>a</h1><div id="d"></div><div id="d"></div>', /ids repetidos: d/);
  assert.doesNotThrow(() =>
    audit(
      'ok',
      page(
        '<h1>a</h1><label for="x">Campo</label><input id="x"><label><input type="checkbox"> Acepto</label><button aria-label="Cerrar">x</button><table><caption>t</caption><tr><th scope="col">C</th></tr></table>',
      ),
    ),
  );
});
