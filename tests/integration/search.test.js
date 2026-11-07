import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import {
  user,
  teamMember,
  project,
  task,
  internalClient,
  externalClient,
} from '../helpers/factories.js';

// Búsqueda global (RF-150, RF-151).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer'])
    user(db, { email: `${role}@t.local`, password_hash: hash, role });
  const aurora = externalClient(db, {
    name: 'Grupo Aurora',
    legal_name: 'Aurora Secreta SA',
    tax_id: 'AUR010101ZZZ',
    hourly_rate_cents: 98765,
  });
  internalClient(db, { name: 'Finanzas' });
  const p1 = project(db, { code: 'PRJ-100', name: 'Portal de clientes', client_id: aurora });
  project(db, { code: 'PRJ-200', name: 'App móvil', client_id: aurora });
  task(db, { project_id: p1, title: 'Diseñar portal de pagos', status: 'todo' });
  task(db, { project_id: p1, title: 'Portal: pruebas', status: 'done' });
  teamMember(db, {
    first_name: 'Ana',
    last_name: 'Portales',
    email: 'ana@empresa.com',
    hourly_cost_cents: 55555,
  });
  teamMember(db, { first_name: 'Beto', last_name: 'Luna', email: 'beto@empresa.com' });
  return { db, app: buildTestApp({ db }), p1 };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}
const search = async (agent, q) => (await agent.get('/api/v1/search').query({ q })).body.data;
const group = (data, key) => data.groups.find((g) => g.key === key);

test('sin sesión: 401 en la API y redirección en la página', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/search?q=portal')).status, 401);
  assert.equal((await request(app).get('/search?q=portal')).headers.location, '/login');
});

test('encuentra proyectos, tareas, clientes y miembros por texto, sin distinguir mayúsculas', async () => {
  const { app, p1 } = setup();
  const agent = await loginAs(app, 'viewer');
  const data = await search(agent, 'PORTAL');
  assert.equal(group(data, 'projects').items[0].title, 'PRJ-100 · Portal de clientes');
  assert.equal(group(data, 'projects').items[0].href, `/projects/${p1}`);
  assert.deepEqual(
    group(data, 'tasks')
      .items.map((i) => i.title)
      .sort(),
    ['Diseñar portal de pagos', 'Portal: pruebas'],
  );
  assert.equal(group(data, 'members').items[0].title, 'Ana Portales');
  assert.equal(group(data, 'clients').total, 0);
  assert.equal(data.total, 1 + 2 + 1);
  const aurora = await search(agent, 'aurora');
  assert.equal(group(aurora, 'clients').items[0].title, 'Grupo Aurora');
  assert.match(group(aurora, 'clients').items[0].href, /^\/clients\/external\/\d+$/);
  assert.equal(group(aurora, 'clients').items[0].subtitle, 'externo');
});

test('también encuentra por código, razón social y correo', async () => {
  const { app } = setup();
  const agent = await loginAs(app, 'pm');
  assert.equal(group(await search(agent, 'prj-200'), 'projects').total, 1);
  assert.equal(group(await search(agent, 'Aurora Secreta'), 'clients').total, 1, 'razón social');
  assert.equal(group(await search(agent, 'beto@empresa'), 'members').total, 1, 'correo');
});

test('no revela datos que los listados no muestran: nunca RFC, tarifas ni costos, aunque se busque por ellos', async () => {
  const { app } = setup();
  for (const who of ['viewer', 'developer', 'admin']) {
    const agent = await loginAs(app, who);
    for (const q of ['AUR010101', '98765', '55555']) {
      const data = await search(agent, q);
      assert.equal(data.total, 0, `${who} buscando «${q}»`);
    }
    const json = JSON.stringify(await search(agent, 'aurora'));
    assert.doesNotMatch(json, /AUR010101|98765|55555|tax|hourly/i, who);
  }
});

test('texto corto o vacío: no consulta y avisa', async () => {
  const { app } = setup();
  const agent = await loginAs(app, 'viewer');
  assert.equal((await search(agent, 'a')).tooShort, true);
  assert.equal((await search(agent, '')).tooShort, true);
  assert.match((await agent.get('/search?q=a')).text, /al menos 2 caracteres/);
  assert.match((await agent.get('/search')).text, /Escribe qué quieres encontrar/);
  assert.equal((await agent.get('/api/v1/search').query({ q: 'x'.repeat(101) })).status, 400);
});

test('el texto de búsqueda es literal: % y _ no son comodines y una inyección SQL no tiene efecto', async () => {
  const { app, db } = setup();
  const agent = await loginAs(app, 'admin');
  assert.equal((await search(agent, '%%')).total, 0);
  assert.equal((await search(agent, '__')).total, 0);
  const evil = await search(agent, "'; DROP TABLE projects; --");
  assert.equal(evil.total, 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'projects'").get());
});

test('máximo 10 por grupo con el total real, y los que empiezan por el texto van primero', async () => {
  const { app, db, p1 } = setup();
  for (let i = 0; i < 14; i += 1)
    task(db, { project_id: p1, title: `Tarea ${String(i).padStart(2, '0')} de pruebas` });
  task(db, { project_id: p1, title: 'Revisar pruebas' });
  const data = await search(await loginAs(app, 'viewer'), 'pruebas');
  const tasks = group(data, 'tasks');
  assert.equal(tasks.items.length, 10);
  assert.equal(tasks.total, 16);
  assert.equal(
    group(await search(await loginAs(app, 'viewer'), 'tarea 0'), 'tasks').items[0].title.startsWith(
      'Tarea 0',
    ),
    true,
  );
  const first = await search(await loginAs(app, 'viewer'), 'portal');
  assert.match(
    group(first, 'tasks').items[0].title,
    /^Portal/,
    'los que empiezan por el texto, primero',
  );
});

test('la página agrupa los resultados, escapa el texto y ofrece «ver más» solo donde hay listado', async () => {
  const { app, db, p1 } = setup();
  task(db, { project_id: p1, title: 'Pruebas <script>alert(1)</script>' });
  for (let i = 0; i < 12; i += 1) project(db, { code: `PRJ-9${i}`, name: `Pruebas ${i}` });
  for (let i = 0; i < 12; i += 1) task(db, { project_id: p1, title: `Pruebas de tarea ${i}` });
  const html = (await (await loginAs(app, 'viewer')).get('/search?q=pruebas')).text;
  assert.match(html, /Proyectos <span[^>]*>\(\d+\)/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="\/projects\?q=pruebas">Ver más/);
  assert.match(html, /Afina la búsqueda para ver el resto/, 'las tareas no tienen listado global');
});

test('el encabezado trae la caja de búsqueda solo con sesión iniciada', async () => {
  const { app } = setup();
  const logged = (await (await loginAs(app, 'viewer')).get('/projects')).text;
  assert.match(logged, /role="search"[\s\S]*id="global-search"/);
  assert.match(logged, /<label for="global-search" class="sr-only">/);
  assert.doesNotMatch((await request(app).get('/login')).text, /global-search/);
});
