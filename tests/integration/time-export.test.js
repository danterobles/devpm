import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import {
  user,
  teamMember,
  internalClient,
  externalClient,
  project,
  task,
  timeEntry,
} from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  user(db, { email: 'admin@test.local', password_hash: hash, role: 'admin' });
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  user(db, { email: 'viewer@test.local', password_hash: hash, role: 'viewer' });
  const ext = externalClient(db, { name: 'Globex' });
  const int = internalClient(db, { name: 'Finanzas' });
  const p1 = project(db, { client_id: ext, code: 'PRJ-2026-001', name: 'Portal' });
  const p2 = project(db, { client_id: int, code: 'PRJ-2026-002', name: 'Interno' });
  const t = task(db, { project_id: p1, title: 'Login, SSO' });
  timeEntry(db, {
    project_id: p1,
    team_member_id: dev,
    task_id: t,
    work_date: '2026-05-11',
    minutes: 90,
    description: 'Sesión "SSO"',
    is_billable: 1,
    status: 'approved',
  });
  timeEntry(db, {
    project_id: p2,
    team_member_id: dev,
    work_date: '2026-05-12',
    minutes: 60,
    description: '=cmd|calc',
    is_billable: 0,
    status: 'draft',
  });
  timeEntry(db, {
    project_id: p1,
    team_member_id: dev,
    work_date: '2026-04-01',
    minutes: 30,
    description: 'Abril',
    is_billable: 1,
    status: 'submitted',
  });
  return { db, ext, int, p1, p2, app: buildTestApp({ db }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@test.local`, password: PASSWORD });
  return agent;
}
const csv = async (agent, qs = '') => {
  const res = await agent
    .get(`/api/v1/time-entries/export.csv${qs}`)
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (data += c));
      r.on('end', () => cb(null, data));
    });
  return res;
};
const lines = (res) => res.body.replace(String.fromCharCode(0xfeff), '').trimEnd().split('\r\n');

test('exportación: solo admin y pm; sin sesión 401; developer y viewer 403', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/api/v1/time-entries/export.csv')).status, 401);
  for (const who of ['dev', 'viewer']) {
    assert.equal((await csv(await loginAs(app, who))).status, 403, who);
  }
  for (const who of ['admin', 'pm']) {
    assert.equal((await csv(await loginAs(app, who))).status, 200, who);
  }
});

test('cabeceras: CSV UTF-8 con BOM y nombre de archivo con la fecha de hoy', async () => {
  const { app } = setup();
  const res = await csv(await loginAs(app, 'pm'));
  assert.match(res.headers['content-type'], /text\/csv; charset=utf-8/);
  assert.match(res.headers['content-disposition'], /attachment; filename="horas-2026-05-13\.csv"/);
  assert.equal(res.body.charCodeAt(0), 0xfeff);
});

test('contenido: encabezados, horas con 2 decimales, escapado y protección contra fórmulas', async () => {
  const { app } = setup();
  const out = lines(await csv(await loginAs(app, 'admin'), '?from=2026-05-01&to=2026-05-31'));
  assert.equal(
    out[0],
    'Fecha,Miembro,Código del proyecto,Proyecto,Cliente,Tipo de cliente,Tarea,Horas,Facturable,Estado,Descripción',
  );
  assert.equal(out.length, 3);
  assert.equal(
    out[1],
    '2026-05-11,Ana Ruiz,PRJ-2026-001,Portal,Globex,externo,"Login, SSO",1.50,Sí,approved,"Sesión ""SSO"""',
  );
  assert.equal(
    out[2],
    "2026-05-12,Ana Ruiz,PRJ-2026-002,Interno,Finanzas,interno,,1.00,No,draft,'=cmd|calc",
  );
});

test('filtros: rango, proyecto, cliente y estado; filtros inválidos 400', async () => {
  const { app, ext, int, p1, p2 } = setup();
  const a = await loginAs(app, 'pm');
  const count = async (qs) => lines(await csv(a, qs)).length - 1;
  assert.equal(await count(''), 3);
  assert.equal(await count('?from=2026-05-01'), 2);
  assert.equal(await count('?to=2026-04-30'), 1);
  assert.equal(await count(`?projectId=${p2}`), 1);
  assert.equal(await count(`?clientId=${ext}`), 2);
  assert.equal(await count(`?clientId=${int}`), 1);
  assert.equal(await count('?status=approved'), 1);
  assert.equal(await count(`?projectId=${p1}&status=submitted`), 1);
  assert.equal((await csv(a, '?from=ayer')).status, 400);
  assert.equal((await csv(a, '?status=raro')).status, 400);
});

test('la exportación no se pagina (incluye más de una página de registros)', async () => {
  const { app, db, p1 } = setup();
  const dev = db.prepare('SELECT id FROM team_members LIMIT 1').pluck().get();
  for (let i = 0; i < 60; i += 1) {
    timeEntry(db, {
      project_id: p1,
      team_member_id: dev,
      work_date: '2026-03-02',
      minutes: 1,
      description: `n${i}`,
    });
  }
  const out = lines(await csv(await loginAs(app, 'admin')));
  assert.equal(out.length, 1 + 63);
});

test('la vista de aprobaciones ofrece la exportación solo a admin y pm', async () => {
  const { app } = setup();
  assert.match((await (await loginAs(app, 'pm')).get('/time/approvals')).text, /export\.csv/);
  assert.doesNotMatch(
    (await (await loginAs(app, 'dev')).get('/time/approvals')).text,
    /export\.csv/,
  );
});
