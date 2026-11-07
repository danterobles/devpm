import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, task, assignment } from '../helpers/factories.js';

// Comentarios y menciones (RF-130 a RF-134).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const dev2 = teamMember(db, { first_name: 'Beto', last_name: 'Luna' });
  const outsider = teamMember(db, { first_name: 'Raúl', last_name: 'Soto' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const mk = (role, name, member = null, o = {}) =>
    user(db, {
      email: `${name}@t.local`,
      password_hash: hash,
      role,
      team_member_id: member,
      full_name: name.toUpperCase(),
      ...o,
    });
  const ids = {
    admin: mk('admin', 'admin'),
    lead: mk('pm', 'lead', lead),
    dev: mk('developer', 'dev', dev),
    dev2: mk('developer', 'dev2', dev2),
    outsider: mk('developer', 'outsider', outsider),
    viewer: mk('viewer', 'viewer'),
  };
  const pid = project(db, {
    code: 'PRJ-1',
    name: 'Portal',
    manager_id: lead,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  const other = project(db, {
    code: 'PRJ-2',
    manager_id: lead,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  for (const m of [dev, dev2, lead])
    assignment(db, {
      project_id: pid,
      team_member_id: m,
      start_date: '2026-03-01',
      end_date: '2026-12-01',
    });
  const tid = task(db, { project_id: pid, title: 'Diseñar modelo', assignee_id: dev });
  const otherTask = task(db, { project_id: other, title: 'Ajena' });
  const events = [];
  const eventBus = {
    emit: (type, payload) => (events.push({ type, ...payload }), { type }),
    subscribe: () => () => {},
    listenerCount: () => 0,
  };
  return { db, ids, pid, tid, otherTask, events, app: buildTestApp({ db, eventBus }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}
const send = (agent, tid, body) => agent.post(`/api/v1/tasks/${tid}/comments`).send({ body });
const notices = (db, userId, type) =>
  db
    .prepare(
      'SELECT * FROM notifications WHERE user_id = ? AND (? IS NULL OR type = ?) ORDER BY id',
    )
    .all(userId, type ?? null, type ?? null);

test('permisos de escritura: admin, pm y developers del proyecto; no el viewer ni quien no está asignado', async () => {
  const { app, tid } = setup();
  for (const who of ['admin', 'lead', 'dev', 'dev2'])
    assert.equal((await send(await loginAs(app, who), tid, `hola de ${who}`)).status, 201, who);
  for (const who of ['viewer', 'outsider'])
    assert.equal((await send(await loginAs(app, who), tid, 'no debería')).status, 403, who);
  assert.equal(
    (await request(app).post(`/api/v1/tasks/${tid}/comments`).send({ body: 'x' })).status,
    401,
  );
});

test('lectura: cualquier usuario autenticado ve la conversación, en orden y con su autor', async () => {
  const { app, tid } = setup();
  await send(await loginAs(app, 'dev'), tid, 'primero');
  await send(await loginAs(app, 'lead'), tid, 'segundo');
  const res = await (await loginAs(app, 'viewer')).get(`/api/v1/tasks/${tid}/comments`);
  assert.deepEqual(
    res.body.data.map((c) => [c.body, c.authorName, c.isEdited]),
    [
      ['primero', 'DEV', false],
      ['segundo', 'LEAD', false],
    ],
  );
  assert.equal(
    (await (await loginAs(app, 'viewer')).get('/api/v1/tasks/9999/comments')).status,
    404,
  );
  assert.equal(
    (await (await loginAs(app, 'viewer')).get('/api/v1/tasks/abc/comments')).status,
    404,
  );
});

test('validación: no vacío, máximo 4 000 caracteres y sin campos extra', async () => {
  const { app, tid } = setup();
  const lead = await loginAs(app, 'lead');
  assert.equal((await send(lead, tid, '   ')).status, 400);
  assert.equal((await send(lead, tid, 'x'.repeat(4001))).status, 400);
  assert.equal((await send(lead, tid, 'x'.repeat(4000))).status, 201);
  assert.equal(
    (await lead.post(`/api/v1/tasks/${tid}/comments`).send({ body: 'ok', userId: 1 })).status,
    400,
  );
  assert.equal((await send(lead, 9999, 'x')).status, 404);
});

test('un developer no comenta en tareas de proyectos donde no está asignado', async () => {
  const { app, otherTask } = setup();
  assert.equal((await send(await loginAs(app, 'dev'), otherTask, 'x')).status, 403);
  assert.equal((await send(await loginAs(app, 'lead'), otherTask, 'x')).status, 201);
});

test('editar: solo el autor (ni el admin ni el líder); marca «editado» y deja bitácora', async () => {
  const { app, db, tid } = setup();
  const dev = await loginAs(app, 'dev');
  const id = (await send(dev, tid, 'original')).body.data.id;
  for (const who of ['admin', 'lead', 'dev2'])
    assert.equal(
      (await (await loginAs(app, who)).patch(`/api/v1/comments/${id}`).send({ body: 'x' })).status,
      403,
      who,
    );
  const res = await dev.patch(`/api/v1/comments/${id}`).send({ body: 'corregido' });
  assert.equal(res.body.data.body, 'corregido');
  assert.equal(res.body.data.isEdited, true);
  const log = db
    .prepare("SELECT action FROM audit_log WHERE entity = 'task_comment' ORDER BY id")
    .pluck()
    .all();
  assert.deepEqual(log, ['create', 'update']);
  // el mismo texto no cuenta como edición
  const same = await dev.patch(`/api/v1/comments/${id}`).send({ body: 'corregido' });
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE action = 'update'").pluck().get(),
    1,
  );
  assert.equal(same.status, 200);
  assert.equal((await dev.patch('/api/v1/comments/9999').send({ body: 'x' })).status, 404);
});

test('eliminar: el autor o un admin; los demás reciben 403; queda en la bitácora', async () => {
  const { app, db, tid } = setup();
  const dev = await loginAs(app, 'dev');
  const mine = (await send(dev, tid, 'mío')).body.data.id;
  const other = (await send(dev, tid, 'otro')).body.data.id;
  assert.equal((await (await loginAs(app, 'lead')).delete(`/api/v1/comments/${mine}`)).status, 403);
  assert.equal(
    (await (await loginAs(app, 'viewer')).delete(`/api/v1/comments/${mine}`)).status,
    403,
  );
  assert.equal((await dev.delete(`/api/v1/comments/${mine}`)).status, 204);
  assert.equal(
    (await (await loginAs(app, 'admin')).delete(`/api/v1/comments/${other}`)).status,
    204,
  );
  assert.equal(db.prepare('SELECT count(*) FROM task_comments').pluck().get(), 0);
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE action = 'delete'").pluck().get(),
    2,
  );
  assert.equal((await dev.delete(`/api/v1/comments/${mine}`)).status, 404);
});

test('eventos: cada alta, edición y baja emite comment.changed con proyecto y tarea', async () => {
  const { app, events, tid, pid } = setup();
  const dev = await loginAs(app, 'dev');
  const id = (await send(dev, tid, 'a')).body.data.id;
  await dev.patch(`/api/v1/comments/${id}`).send({ body: 'b' });
  await dev.patch(`/api/v1/comments/${id}`).send({ body: 'b' }); // sin cambios: no emite
  await dev.delete(`/api/v1/comments/${id}`);
  const got = events.filter((e) => e.type === 'comment.changed');
  assert.equal(got.length, 3);
  assert.ok(got.every((e) => e.projectId === pid && e.taskId === tid));
});

test('avisos: al responsable y al líder, no a quien comenta; un solo aviso por persona', async () => {
  const { app, db, tid, ids } = setup();
  await send(await loginAs(app, 'dev2'), tid, 'Una duda sobre el modelo');
  assert.equal(notices(db, ids.dev, 'task_comment').length, 1, 'responsable');
  assert.equal(notices(db, ids.lead, 'task_comment').length, 1, 'líder');
  assert.equal(notices(db, ids.dev2).length, 0, 'quien comenta no se avisa');
  const n = notices(db, ids.dev, 'task_comment')[0];
  assert.match(n.body, /DEV2 en «Diseñar modelo»: Una duda/);
  assert.equal(n.link, `/tasks/${tid}#comentarios`);
  // el líder comenta: avisa al responsable pero no a sí mismo
  await send(await loginAs(app, 'lead'), tid, 'Respondo');
  assert.equal(notices(db, ids.dev, 'task_comment').length, 2);
  assert.equal(notices(db, ids.lead, 'task_comment').length, 1);
});

test('menciones: por correo completo a usuarios activos; la mención gana al aviso de comentario', async () => {
  const { app, db, tid, ids } = setup();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(ids.outsider);
  await send(
    await loginAs(app, 'lead'),
    tid,
    'Ojo @DEV@t.local y @dev2@t.local; también @outsider@t.local, @nadie@t.local y @viewer',
  );
  const m = notices(db, ids.dev, 'task_mention');
  assert.equal(m.length, 1);
  assert.match(m[0].title, /Te mencionaron/);
  assert.equal(notices(db, ids.dev, 'task_comment').length, 0, 'ya recibió la mención');
  assert.equal(notices(db, ids.dev2, 'task_mention').length, 1);
  assert.equal(notices(db, ids.outsider).length, 0, 'usuario inactivo');
  assert.equal(notices(db, ids.viewer).length, 0, 'sin correo completo no hay mención');
  // mencionarse a uno mismo no avisa
  await send(await loginAs(app, 'lead'), tid, 'Nota para mí @lead@t.local');
  assert.equal(notices(db, ids.lead).length, 0);
});

test('editar no vuelve a avisar y eliminar no retira los avisos enviados', async () => {
  const { app, db, tid, ids } = setup();
  const lead = await loginAs(app, 'lead');
  const id = (await send(lead, tid, 'versión 1')).body.data.id;
  await lead.patch(`/api/v1/comments/${id}`).send({ body: 'versión 2 @dev2@t.local' });
  assert.equal(notices(db, ids.dev2).length, 0);
  await lead.delete(`/api/v1/comments/${id}`);
  assert.equal(notices(db, ids.dev).length, 1);
});

test('ficha de la tarea: muestra la conversación, el formulario y se actualiza en vivo', async () => {
  const { app, tid } = setup();
  await send(await loginAs(app, 'dev'), tid, 'Hola equipo');
  const html = (await (await loginAs(app, 'dev')).get(`/tasks/${tid}`)).text;
  assert.match(html, /id="comentarios"[^>]*data-comments[^>]*data-live/);
  assert.match(html, /Hola equipo/);
  assert.match(html, /action="\/tasks\/\d+\/comments"/);
  assert.match(html, /\/js\/pages\/comments\.js/);
  assert.equal((await request(app).get('/js/pages/comments.js')).status, 200);
});

test('ficha de la tarea: el viewer y quien no está asignado leen pero no ven el formulario', async () => {
  const { app, tid } = setup();
  await send(await loginAs(app, 'dev'), tid, 'Visible para todos');
  for (const who of ['viewer', 'outsider']) {
    const html = (await (await loginAs(app, who)).get(`/tasks/${tid}`)).text;
    assert.match(html, /Visible para todos/, who);
    assert.doesNotMatch(html, /name="body"/, who);
    assert.match(html, /Solo el equipo asignado al proyecto puede comentar/, who);
  }
});

test('HTML: comentar, editar y eliminar desde la ficha redirigen a la conversación', async () => {
  const { app, db, tid } = setup();
  const dev = await loginAs(app, 'dev');
  const created = await dev
    .post(`/tasks/${tid}/comments`)
    .type('form')
    .send({ body: 'Desde el formulario' });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, `/tasks/${tid}#comentarios`);
  const id = db.prepare('SELECT id FROM task_comments').pluck().get();
  const html = (await dev.get(`/tasks/${tid}`)).text;
  assert.match(html, new RegExp(`action="/comments/${id}"`));
  assert.match(html, new RegExp(`action="/comments/${id}/delete"`));
  await dev.post(`/comments/${id}`).type('form').send({ body: 'Editado' });
  assert.equal(
    db.prepare('SELECT body FROM task_comments WHERE id = ?').pluck().get(id),
    'Editado',
  );
  assert.equal(
    (await dev.post(`/comments/${id}/delete`).type('form').send({})).headers.location,
    `/tasks/${tid}#comentarios`,
  );
  assert.equal(db.prepare('SELECT count(*) FROM task_comments').pluck().get(), 0);
  assert.equal(
    (await dev.post(`/tasks/${tid}/comments`).type('form').send({ body: '' })).status,
    400,
  );
});

test('el texto de los comentarios se escapa (XSS) y conserva los saltos de línea', async () => {
  const { app, tid } = setup();
  await send(
    await loginAs(app, 'dev'),
    tid,
    '<script>alert(1)</script>\n<img src=x onerror=alert(1)>',
  );
  const html = (await (await loginAs(app, 'dev')).get(`/tasks/${tid}`)).text;
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /whitespace-pre-line/);
});

test('al eliminar la tarea se eliminan sus comentarios', async () => {
  const { app, db, tid } = setup();
  await send(await loginAs(app, 'lead'), tid, 'se irá con la tarea');
  assert.equal((await (await loginAs(app, 'lead')).delete(`/api/v1/tasks/${tid}`)).status, 204);
  assert.equal(db.prepare('SELECT count(*) FROM task_comments').pluck().get(), 0);
});
