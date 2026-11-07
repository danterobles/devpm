import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember, project, task, assignment } from '../helpers/factories.js';

// Filtros guardados (RF-152) y los filtros del backlog sobre los que se apoyan.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

function setup() {
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const mk = (role, name, member = null) =>
    user(db, { email: `${name}@t.local`, password_hash: hash, role, team_member_id: member });
  mk('admin', 'admin');
  mk('pm', 'pm');
  mk('developer', 'dev', dev);
  mk('viewer', 'viewer');
  const pid = project(db, {
    code: 'PRJ-1',
    name: 'Portal',
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  assignment(db, {
    project_id: pid,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-12-01',
  });
  return { db, pid, dev, app: buildTestApp({ db }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}
const save = (agent, body) => agent.post('/api/v1/saved-filters').send(body);

test('sin sesión: 401 en la API y redirección en los formularios', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/saved-filters')).status, 401);
  assert.equal((await request(app).post('/api/v1/saved-filters').send({})).status, 401);
  assert.equal(
    (await request(app).post('/saved-filters').type('form').send({})).headers.location,
    '/login',
  );
});

test('crear: guarda solo los filtros permitidos, en orden y sin vacíos ni «all»', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const res = await save(pm, {
    scope: 'projects',
    name: 'Activos críticos',
    query: 'priority=critical&status=active&q=%20portal%20&page=3&pageSize=100&foo=bar&clientId=',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.query, 'q=portal&status=active&priority=critical');
  const asObject = await save(pm, {
    scope: 'time',
    name: 'Aprobados de mayo',
    query: { from: '2026-05-01', to: '2026-05-31', status: 'approved', extra: 'x' },
  });
  assert.equal(asObject.body.data.query, 'from=2026-05-01&to=2026-05-31&status=approved');
  const all = await save(pm, {
    scope: 'tasks',
    name: 'Todo menos nada',
    query: 'type=all&priority=high',
  });
  assert.equal(all.body.data.query, 'priority=high');
});

test('validación: nombre, ámbito, valores inválidos y filtro vacío', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const bad = [
    [{ scope: 'otro', name: 'x', query: 'q=a' }, /Ámbito/],
    [{ scope: 'projects', name: '   ', query: 'q=a' }, /nombre/i],
    [{ scope: 'projects', name: 'x'.repeat(61), query: 'q=a' }, /60 caracteres/],
    [{ scope: 'projects', name: 'x', query: 'status=inventado' }, /status|Invalid|inválid/i],
    [{ scope: 'projects', name: 'x', query: 'clientId=abc' }, /clientId/],
    [{ scope: 'time', name: 'x', query: 'from=2026-13-45' }, /Fecha inválida/],
    [{ scope: 'projects', name: 'x', query: '' }, /al menos un filtro/],
    [{ scope: 'projects', name: 'x', query: 'page=2&foo=bar' }, /al menos un filtro/],
    [{ scope: 'projects', name: 'x', query: 'q=a', userId: 1 }, /./],
  ];
  for (const [body, pattern] of bad) {
    const res = await save(pm, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(JSON.stringify(res.body), pattern, JSON.stringify(body));
  }
  assert.equal((await pm.get('/api/v1/saved-filters')).body.data.length, 0);
});

test('nombre único por persona y ámbito (sin distinguir mayúsculas); máximo 20 por persona', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  assert.equal(
    (await save(pm, { scope: 'projects', name: 'Mis activos', query: 'status=active' })).status,
    201,
  );
  assert.equal(
    (await save(pm, { scope: 'projects', name: 'mis ACTIVOS', query: 'status=on_hold' })).status,
    409,
  );
  assert.equal(
    (await save(pm, { scope: 'tasks', name: 'Mis activos', query: 'priority=high' })).status,
    201,
    'otro ámbito',
  );
  assert.equal(
    (
      await save(await loginAs(app, 'admin'), {
        scope: 'projects',
        name: 'Mis activos',
        query: 'q=a',
      })
    ).status,
    201,
    'otra persona',
  );
  for (let i = 2; i < 20; i += 1)
    assert.equal(
      (await save(pm, { scope: 'projects', name: `Filtro ${i}`, query: `q=f${i}` })).status,
      201,
      `filtro ${i}`,
    );
  const over = await save(pm, { scope: 'projects', name: 'El 21', query: 'q=z' });
  assert.equal(over.status, 422);
  assert.match(over.body.error.message, /máximo/);
});

test('cada persona ve y elimina solo los suyos; filtrar por ámbito', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const admin = await loginAs(app, 'admin');
  const mine = (await save(pm, { scope: 'projects', name: 'Míos', query: 'q=a' })).body.data.id;
  await save(pm, { scope: 'time', name: 'Tiempo', query: 'status=approved' });
  await save(admin, { scope: 'projects', name: 'Del admin', query: 'q=b' });
  assert.deepEqual((await pm.get('/api/v1/saved-filters')).body.data.map((f) => f.name).sort(), [
    'Míos',
    'Tiempo',
  ]);
  assert.deepEqual(
    (await pm.get('/api/v1/saved-filters?scope=time')).body.data.map((f) => f.name),
    ['Tiempo'],
  );
  assert.equal((await pm.get('/api/v1/saved-filters?scope=otro')).status, 400);
  assert.equal((await admin.delete(`/api/v1/saved-filters/${mine}`)).status, 404, 'ajeno');
  assert.equal((await pm.delete('/api/v1/saved-filters/abc')).status, 404);
  assert.equal((await pm.delete(`/api/v1/saved-filters/${mine}`)).status, 204);
  assert.equal((await pm.delete(`/api/v1/saved-filters/${mine}`)).status, 404);
  assert.equal((await admin.get('/api/v1/saved-filters')).body.data.length, 1);
});

test('formularios: guardar y eliminar redirigen al listado con el filtro aplicado', async () => {
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const p = await pm
    .post('/saved-filters')
    .type('form')
    .send({ scope: 'projects', name: 'Activos', query: 'status=active&q=Portal' });
  assert.equal(p.headers.location, '/projects?q=Portal&status=active');
  const t = await pm
    .post('/saved-filters')
    .type('form')
    .send({ scope: 'tasks', name: 'Bugs', query: 'type=bug', projectId: String(pid) });
  assert.equal(t.headers.location, `/projects/${pid}/backlog?type=bug`);
  // sin proyecto no hay a dónde volver
  assert.equal(
    (
      await pm
        .post('/saved-filters')
        .type('form')
        .send({ scope: 'tasks', name: 'Sin', query: 'type=bug' })
    ).status,
    404,
  );
  // «time»: los filtros llegan como campos del formulario de exportación
  const tm = await pm.post('/saved-filters').type('form').send({
    scope: 'time',
    name: 'Mayo',
    from: '2026-05-01',
    to: '2026-05-31',
    status: 'approved',
  });
  assert.equal(
    tm.headers.location,
    '/time/approvals?from=2026-05-01&to=2026-05-31&status=approved',
  );
  assert.equal(
    (await pm.post('/saved-filters').type('form').send({ scope: 'time', name: '', status: 'all' }))
      .status,
    400,
  );
  const id = (await pm.get('/api/v1/saved-filters?scope=projects')).body.data[0].id;
  assert.equal(
    (await pm.post(`/saved-filters/${id}/delete`).type('form').send({})).headers.location,
    '/projects',
  );
  const tid = (await pm.get('/api/v1/saved-filters?scope=tasks')).body.data[0].id;
  assert.equal(
    (
      await pm
        .post(`/saved-filters/${tid}/delete`)
        .type('form')
        .send({ projectId: String(pid) })
    ).headers.location,
    `/projects/${pid}/backlog`,
  );
});

test('proyectos: el listado muestra los filtros guardados y permite guardar el actual', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  await save(pm, { scope: 'projects', name: '<b>Activos</b>', query: 'status=active' });
  const none = (await pm.get('/projects')).text;
  assert.match(none, /Filtros guardados \(1\)/);
  assert.match(none, /Aplica algún filtro para poder guardarlo/);
  assert.doesNotMatch(none, /<b>Activos<\/b>/, 'el nombre se escapa');
  assert.match(none, /href="\/projects\?status=active"/);
  const filtered = (await pm.get('/projects?status=active&q=Portal&page=2')).text;
  assert.match(filtered, /name="query" value="q=Portal&amp;status=active"/);
  assert.match(filtered, /name="name"/);
  // otra persona no ve los filtros ajenos
  assert.match(
    (await (await loginAs(app, 'viewer')).get('/projects')).text,
    /Filtros guardados \(0\)/,
  );
});

test('backlog: filtra por texto, tipo, prioridad y responsable; ignora valores inválidos', async () => {
  const { app, db, pid, dev } = setup();
  task(db, {
    project_id: pid,
    title: 'Login con correo',
    type: 'feature',
    priority: 'high',
    assignee_id: dev,
  });
  task(db, { project_id: pid, title: 'Error de paginación', type: 'bug', priority: 'low' });
  task(db, { project_id: pid, title: 'Login con Google', type: 'bug', priority: 'high' });
  const viewer = await loginAs(app, 'viewer');
  const page = async (qs) => (await viewer.get(`/projects/${pid}/backlog${qs}`)).text;
  const titles = (html) => [...html.matchAll(/href="\/tasks\/\d+">([^<]+)</g)].map((m) => m[1]);
  assert.equal(titles(await page('')).length, 3);
  assert.deepEqual(titles(await page('?q=login')).sort(), ['Login con Google', 'Login con correo']);
  assert.deepEqual(titles(await page('?type=bug&priority=high')), ['Login con Google']);
  assert.deepEqual(titles(await page(`?assigneeId=${dev}`)), ['Login con correo']);
  assert.equal(titles(await page('?type=inventado&priority=otro&assigneeId=abc')).length, 3);
  assert.match(await page('?q=login'), /Mostrando 2 de 3 tareas/);
  assert.doesNotMatch(await page(''), /Mostrando/);
});

test('backlog: guardar un filtro y aplicarlo desde la lista', async () => {
  const { app, pid } = setup();
  const pm = await loginAs(app, 'pm');
  const html = (await pm.get(`/projects/${pid}/backlog?type=bug`)).text;
  assert.match(html, new RegExp(`name="projectId" value="${pid}"`));
  await pm
    .post('/saved-filters')
    .type('form')
    .send({ scope: 'tasks', name: 'Bugs', query: 'type=bug', projectId: String(pid) });
  const after = (await pm.get(`/projects/${pid}/backlog`)).text;
  assert.match(after, new RegExp(`href="/projects/${pid}/backlog\\?type=bug">Bugs<`));
});

test('aprobaciones: la exportación se rellena con los filtros y se guardan desde su formulario', async () => {
  const { app } = setup();
  const pm = await loginAs(app, 'pm');
  const html = (await pm.get('/time/approvals?from=2026-05-01&to=2026-05-31&status=approved')).text;
  assert.match(html, /name="from" type="date" value="2026-05-01"/);
  assert.match(html, /name="to" type="date" value="2026-05-31"/);
  assert.match(html, /<option value="approved" selected>/);
  assert.match(html, /formaction="\/saved-filters"/);
  assert.match(html, /Filtros guardados \(0\)/);
  assert.doesNotMatch(
    html,
    /Aplica algún filtro para poder guardarlo/,
    'en «time» el guardado es el del propio formulario',
  );
  const bad = (await pm.get('/time/approvals?from=nada&status=raro')).text;
  assert.match(bad, /name="from" type="date" value=""/);
  assert.equal((await (await loginAs(app, 'viewer')).get('/time/approvals')).status, 403);
});
