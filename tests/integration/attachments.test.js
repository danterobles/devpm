import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp, testConfig } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, task, assignment } from '../helpers/factories.js';

// Adjuntos de tareas (RF-140 a RF-144).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
const dirs = [];
afterEach(() => setClock(() => new Date()));
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(50),
]);
const PDF = Buffer.from('%PDF-1.7\n%contenido');

function setup(overrides = {}) {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpm-att-'));
  dirs.push(uploadDir);
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const outsider = teamMember(db, { first_name: 'Raúl', last_name: 'Soto' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const mk = (role, name, member = null) =>
    user(db, {
      email: `${name}@t.local`,
      password_hash: hash,
      role,
      team_member_id: member,
      full_name: name.toUpperCase(),
    });
  const ids = {
    admin: mk('admin', 'admin'),
    lead: mk('pm', 'lead', lead),
    dev: mk('developer', 'dev', dev),
    outsider: mk('developer', 'outsider', outsider),
    viewer: mk('viewer', 'viewer'),
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
      end_date: '2026-12-01',
    });
  const tid = task(db, { project_id: pid, title: 'Diseñar modelo', assignee_id: dev });
  const config = testConfig({ UPLOAD_DIR: uploadDir, ...overrides });
  return { db, ids, pid, tid, uploadDir, app: buildTestApp({ db, config }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}
const upload = (agent, tid, name, body, type = 'application/octet-stream') =>
  agent
    .post(`/api/v1/tasks/${tid}/attachments?name=${encodeURIComponent(name)}`)
    .set('Content-Type', type)
    .send(body);
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

test('permisos de subida: admin, pm y developers del proyecto; no el viewer ni quien no está asignado', async () => {
  const { app, tid } = setup();
  for (const who of ['admin', 'lead', 'dev'])
    assert.equal((await upload(await loginAs(app, who), tid, `${who}.png`, PNG)).status, 201, who);
  for (const who of ['viewer', 'outsider'])
    assert.equal((await upload(await loginAs(app, who), tid, 'x.png', PNG)).status, 403, who);
  assert.equal(
    (await request(app).post(`/api/v1/tasks/${tid}/attachments?name=x.png`).send(PNG)).status,
    401,
  );
  assert.equal((await upload(await loginAs(app, 'admin'), 9999, 'x.png', PNG)).status, 404);
});

test('subir guarda el archivo con nombre aleatorio (0600) y registra el adjunto y la bitácora', async () => {
  const { app, db, tid, uploadDir, ids } = setup();
  const res = await upload(await loginAs(app, 'dev'), tid, 'Diagrama ñandú.png', PNG);
  assert.equal(res.status, 201);
  const a = res.body.data;
  assert.equal(a.name, 'Diagrama ñandú.png');
  assert.equal(a.contentType, 'image/png');
  assert.equal(a.sizeBytes, PNG.length);
  assert.equal(a.uploaderName, 'DEV');
  const stored = db.prepare('SELECT stored_name FROM task_attachments').pluck().get();
  assert.match(stored, /^[a-f0-9]{32}$/);
  assert.deepEqual(files(uploadDir), [stored]);
  assert.equal(fs.statSync(path.join(uploadDir, stored)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(uploadDir).mode & 0o777, 0o700);
  assert.deepEqual(fs.readFileSync(path.join(uploadDir, stored)), PNG);
  assert.equal(
    db.prepare("SELECT user_id FROM audit_log WHERE entity = 'task_attachment'").pluck().get(),
    ids.dev,
  );
});

test('rechaza tipos no permitidos o que no corresponden a su contenido, sin guardar nada', async () => {
  const { app, db, tid, uploadDir } = setup();
  const lead = await loginAs(app, 'lead');
  const bad = [
    ['pagina.html', Buffer.from('<html><script>alert(1)</script></html>')],
    [
      'dibujo.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ],
    ['programa.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00])],
    ['falsa.png', Buffer.from('<script>alert(1)</script>')],
    ['foto.jpg', PNG],
    ['sin-extension', PNG],
    ['paquete.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ];
  for (const [name, body] of bad) {
    const res = await upload(lead, tid, name, body);
    assert.equal(res.status, 400, name);
    assert.match(JSON.stringify(res.body), /no permitido|no corresponde/, name);
  }
  assert.equal(db.prepare('SELECT count(*) FROM task_attachments').pluck().get(), 0);
  assert.deepEqual(files(uploadDir), []);
});

test('el tipo lo decide el contenido, no el Content-Type que declare el navegador', async () => {
  const { app, tid } = setup();
  const res = await upload(await loginAs(app, 'lead'), tid, 'doc.pdf', PDF, 'text/html');
  assert.equal(res.status, 201);
  assert.equal(res.body.data.contentType, 'application/pdf');
});

test('tamaño: vacío = 400; más del máximo = 413 sin guardar; el máximo exacto se acepta', async () => {
  const { app, tid, uploadDir } = setup({ UPLOAD_MAX_MB: '1' });
  const lead = await loginAs(app, 'lead');
  assert.equal((await upload(lead, tid, 'a.png', Buffer.alloc(0))).status, 400);
  const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
  const tooBig = await upload(lead, tid, 'grande.png', big);
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.body.error.message, /supera 1 MB/);
  assert.deepEqual(files(uploadDir), []);
  const edge = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 - PNG.length)]);
  assert.equal((await upload(lead, tid, 'justo.png', edge)).status, 201);
});

test('máximo de 10 adjuntos por tarea', async () => {
  const { app, tid, db } = setup();
  const lead = await loginAs(app, 'lead');
  for (let i = 0; i < 10; i += 1)
    assert.equal((await upload(lead, tid, `f${i}.png`, PNG)).status, 201, `adjunto ${i}`);
  const res = await upload(lead, tid, 'once.png', PNG);
  assert.equal(res.status, 422);
  assert.match(res.body.error.message, /máximo/);
  assert.equal(db.prepare('SELECT count(*) FROM task_attachments').pluck().get(), 10);
});

test('el nombre no puede salirse de la carpeta ni de la tarea: ../ se limpia y el archivo se guarda con nombre aleatorio', async () => {
  const { app, db, tid, uploadDir } = setup();
  const res = await upload(await loginAs(app, 'lead'), tid, '../../../etc/passwd.png', PNG);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'passwd.png');
  assert.equal(files(uploadDir).length, 1);
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'passwd.png')));
  // un stored_name manipulado en la base nunca se resuelve fuera de la carpeta
  db.prepare("UPDATE task_attachments SET stored_name = '../../etc/passwd'").run();
  assert.equal(
    (await (await loginAs(app, 'lead')).get(`/attachments/${res.body.data.id}`)).status,
    404,
  );
});

test('descarga: cualquier usuario autenticado, siempre como adjunto, con nosniff y sandbox', async () => {
  const { app, tid } = setup();
  const created = await upload(await loginAs(app, 'dev'), tid, 'Reporte ñandú.pdf', PDF);
  const id = created.body.data.id;
  for (const who of ['viewer', 'outsider', 'admin']) {
    const res = await (await loginAs(app, who)).get(`/attachments/${id}`);
    assert.equal(res.status, 200, who);
    assert.match(res.headers['content-disposition'], /^attachment;/);
    assert.match(
      res.headers['content-disposition'],
      /filename\*=UTF-8''Reporte%20%C3%B1and%C3%BA\.pdf/,
    );
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /sandbox/);
    assert.match(res.headers['cache-control'], /no-store/);
    assert.deepEqual(res.body, PDF);
  }
  assert.equal((await request(app).get(`/attachments/${id}`)).headers.location, '/login');
  assert.equal((await request(app).get(`/api/v1/attachments/${id}`)).status, 401);
  assert.equal((await (await loginAs(app, 'viewer')).get('/attachments/9999')).status, 404);
  assert.equal((await (await loginAs(app, 'viewer')).get('/attachments/abc')).status, 404);
});

test('un archivo que ya no está en disco responde 404 (sin error interno)', async () => {
  const { app, tid, uploadDir } = setup();
  const id = (await upload(await loginAs(app, 'dev'), tid, 'a.png', PNG)).body.data.id;
  for (const f of files(uploadDir)) fs.rmSync(path.join(uploadDir, f));
  assert.equal((await (await loginAs(app, 'dev')).get(`/attachments/${id}`)).status, 404);
});

test('eliminar: quien lo subió o un admin; borra el archivo y el registro; los demás reciben 403', async () => {
  const { app, db, tid, uploadDir } = setup();
  const dev = await loginAs(app, 'dev');
  const a = (await upload(dev, tid, 'a.png', PNG)).body.data.id;
  const b = (await upload(dev, tid, 'b.png', PNG)).body.data.id;
  assert.equal((await (await loginAs(app, 'lead')).delete(`/api/v1/attachments/${a}`)).status, 403);
  assert.equal(
    (await (await loginAs(app, 'viewer')).delete(`/api/v1/attachments/${a}`)).status,
    403,
  );
  assert.equal((await dev.delete(`/api/v1/attachments/${a}`)).status, 204);
  assert.equal(files(uploadDir).length, 1);
  assert.equal(
    (await (await loginAs(app, 'admin')).delete(`/api/v1/attachments/${b}`)).status,
    204,
  );
  assert.deepEqual(files(uploadDir), []);
  assert.equal(db.prepare('SELECT count(*) FROM task_attachments').pluck().get(), 0);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) FROM audit_log WHERE entity = 'task_attachment' AND action = 'delete'",
      )
      .pluck()
      .get(),
    2,
  );
  assert.equal((await dev.delete(`/api/v1/attachments/${a}`)).status, 404);
});

test('al eliminar la tarea se eliminan sus adjuntos y sus archivos', async () => {
  const { app, db, tid, uploadDir } = setup();
  const lead = await loginAs(app, 'lead');
  await upload(lead, tid, 'a.png', PNG);
  await upload(lead, tid, 'b.pdf', PDF);
  assert.equal(files(uploadDir).length, 2);
  assert.equal((await lead.delete(`/api/v1/tasks/${tid}`)).status, 204);
  assert.equal(db.prepare('SELECT count(*) FROM task_attachments').pluck().get(), 0);
  assert.deepEqual(files(uploadDir), []);
});

test('sweep: elimina los archivos sin registro y respeta los que sí lo tienen y los ajenos', async () => {
  const { app, tid, uploadDir } = setup();
  await upload(await loginAs(app, 'lead'), tid, 'a.png', PNG);
  fs.writeFileSync(path.join(uploadDir, 'a'.repeat(32)), 'huérfano');
  fs.writeFileSync(path.join(uploadDir, 'notas.txt'), 'no es de la aplicación');
  assert.equal(app.locals.attachments.sweep(), 1);
  assert.equal(files(uploadDir).length, 2);
  assert.ok(files(uploadDir).includes('notas.txt'));
});

test('ficha de la tarea: lista, enlace de descarga, formulario según permiso y script', async () => {
  const { app, tid } = setup();
  await upload(await loginAs(app, 'dev'), tid, '<b>informe</b>.pdf', PDF);
  const dev = (await (await loginAs(app, 'dev')).get(`/tasks/${tid}`)).text;
  assert.match(dev, /id="adjuntos"/);
  assert.match(dev, /data-attachment-input/);
  assert.match(dev, /href="\/attachments\/\d+"/);
  assert.match(dev, /action="\/attachments\/\d+\/delete"/);
  assert.match(dev, /\/js\/pages\/attachments\.js/);
  assert.doesNotMatch(dev, /<b>informe<\/b>/, 'el nombre se escapa');
  const viewer = (await (await loginAs(app, 'viewer')).get(`/tasks/${tid}`)).text;
  assert.match(viewer, /href="\/attachments\/\d+"/);
  assert.doesNotMatch(viewer, /data-attachment-input|action="\/attachments\/\d+\/delete"/);
  assert.match(viewer, /Solo el equipo asignado al proyecto puede adjuntar/);
  assert.equal((await request(app).get('/js/pages/attachments.js')).status, 200);
});

test('HTML: eliminar desde la ficha redirige a la sección de adjuntos', async () => {
  const { app, tid } = setup();
  const dev = await loginAs(app, 'dev');
  const id = (await upload(dev, tid, 'a.png', PNG)).body.data.id;
  const res = await dev.post(`/attachments/${id}/delete`).type('form').send({});
  assert.equal(res.headers.location, `/tasks/${tid}#adjuntos`);
});

test('el listado de la API muestra los adjuntos de la tarea a cualquier usuario autenticado', async () => {
  const { app, tid } = setup();
  await upload(await loginAs(app, 'lead'), tid, 'a.png', PNG);
  const res = await (await loginAs(app, 'viewer')).get(`/api/v1/tasks/${tid}/attachments`);
  assert.deepEqual(
    res.body.data.map((a) => a.name),
    ['a.png'],
  );
  assert.equal(
    (await (await loginAs(app, 'viewer')).get('/api/v1/tasks/9999/attachments')).status,
    404,
  );
});
