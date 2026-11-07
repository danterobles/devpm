import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp, testConfig } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember, project, task, assignment } from '../helpers/factories.js';

// Recorrido de aceptación de la v0.4 (CHECKLIST, Etapa 21): comentar con mención → aviso;
// adjuntar y descargar; buscar y guardar un filtro. Cada paso se hace como lo haría una persona.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpm-v04-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}

test('v0.4 de punta a punta: comentario con mención, adjunto, búsqueda y filtro guardado', async () => {
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  user(db, {
    email: 'lead@t.local',
    password_hash: hash,
    role: 'pm',
    team_member_id: lead,
    full_name: 'Lía Vega',
  });
  user(db, {
    email: 'dev@t.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
    full_name: 'Ana Ruiz',
  });
  user(db, { email: 'viewer@t.local', password_hash: hash, role: 'viewer' });
  const pid = project(db, {
    code: 'PRJ-1',
    name: 'Portal de clientes',
    status: 'active',
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
  const tid = task(db, { project_id: pid, title: 'Diseñar el modelo de datos', assignee_id: dev });
  const app = buildTestApp({ db, config: testConfig({ UPLOAD_DIR: dir }) });
  const lia = await loginAs(app, 'lead');
  const ana = await loginAs(app, 'dev');
  const vera = await loginAs(app, 'viewer');

  // 1. La líder comenta mencionando a Ana desde la ficha de la tarea
  const posted = await lia
    .post(`/tasks/${tid}/comments`)
    .type('form')
    .send({ body: '@dev@t.local ¿puedes revisar el diagrama?' });
  assert.equal(posted.headers.location, `/tasks/${tid}#comentarios`);
  // …y Ana ve el aviso en la campana, en su página de notificaciones y en «Mi día»
  assert.match((await ana.get('/projects')).text, /Notificaciones, 1 sin leer/);
  const bell = await ana.get('/notifications');
  assert.match(bell.text, /Te mencionaron en una tarea/);
  assert.match((await ana.get('/')).text, /Te mencionaron en una tarea/);
  const open = await ana.post(
    `/notifications/${db.prepare('SELECT id FROM notifications').pluck().get()}/open`,
  );
  assert.equal(open.headers.location, `/tasks/${tid}#comentarios`);
  assert.match((await ana.get('/projects')).text, /Notificaciones, 0 sin leer/);

  // 2. Ana responde y adjunta el diagrama; la líder lo descarga; la observadora solo lo lee
  await ana
    .post(`/tasks/${tid}/comments`)
    .type('form')
    .send({ body: 'Listo, adjunto el diagrama.' });
  const up = await ana
    .post(`/api/v1/tasks/${tid}/attachments?name=${encodeURIComponent('diagrama.png')}`)
    .set('Content-Type', 'application/octet-stream')
    .send(PNG);
  assert.equal(up.status, 201);
  const file = await lia.get(`/attachments/${up.body.data.id}`);
  assert.equal(file.status, 200);
  assert.match(file.headers['content-disposition'], /^attachment;/);
  assert.deepEqual(file.body, PNG);
  const page = (await vera.get(`/tasks/${tid}`)).text;
  assert.match(page, /Listo, adjunto el diagrama/);
  assert.match(page, /diagrama\.png/);
  assert.doesNotMatch(page, /name="body"|data-attachment-input/);
  assert.equal(
    (await vera.post(`/tasks/${tid}/comments`).type('form').send({ body: 'x' })).status,
    403,
  );

  // 3. Búsqueda global: se encuentra la tarea y el proyecto
  const found = (await vera.get('/search?q=modelo')).text;
  assert.match(found, /Diseñar el modelo de datos/);
  assert.match((await vera.get('/search?q=portal')).text, /PRJ-1 · Portal de clientes/);

  // 4. Filtro guardado: la líder guarda «Activos» en proyectos y lo aplica con un clic
  const saved = await lia
    .post('/saved-filters')
    .type('form')
    .send({ scope: 'projects', name: 'Activos', query: 'status=active' });
  assert.equal(saved.headers.location, '/projects?status=active');
  const list = (await lia.get('/projects')).text;
  assert.match(list, /href="\/projects\?status=active">Activos</);
  assert.match((await lia.get('/projects?status=active')).text, /PRJ-1/);
});
