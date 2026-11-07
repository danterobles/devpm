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
  project,
  task,
  milestone,
  timeEntry,
  assignment,
} from '../helpers/factories.js';

// «Mi día» (RF-110 a RF-114): el inicio muestra el panel que corresponde a cada rol.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z')); // miércoles
  const db = createTestDb();
  const dev = teamMember(db, {
    first_name: 'Ana',
    last_name: 'Ruiz',
    weekly_capacity_minutes: 2400,
  });
  const dev2 = teamMember(db, { first_name: 'Beto', last_name: 'Luna' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const lead2 = teamMember(db, { first_name: 'Raúl', last_name: 'Soto' });
  const mkUser = (role, email, member = null, name = 'Persona Prueba') =>
    user(db, {
      email: `${email}@t.local`,
      password_hash: hash,
      role,
      team_member_id: member,
      full_name: name,
    });
  const ids = {
    admin: mkUser('admin', 'admin', null, 'Ada Admin'),
    lead: mkUser('pm', 'lead', lead, 'Lía Vega'),
    lead2: mkUser('pm', 'lead2', lead2, 'Raúl Soto'),
    dev: mkUser('developer', 'dev', dev, 'Ana Ruiz'),
    dev2: mkUser('developer', 'dev2', dev2, 'Beto Luna'),
    viewer: mkUser('viewer', 'viewer', null, 'Vera Viewer'),
  };
  const mine = project(db, {
    code: 'PRJ-1',
    name: 'Portal',
    status: 'active',
    manager_id: lead,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  const other = project(db, {
    code: 'PRJ-2',
    name: 'App móvil',
    status: 'active',
    manager_id: lead2,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  for (const p of [mine, other])
    for (const m of [dev, dev2, lead, lead2])
      assignment(db, {
        project_id: p,
        team_member_id: m,
        start_date: '2026-03-01',
        end_date: '2026-06-30',
      });
  return { db, app: buildTestApp({ db }), ids, mine, other, dev, dev2, lead, lead2 };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}
const home = async (app, who) => (await (await loginAs(app, who)).get('/')).text;

test('sin sesión el inicio redirige al login', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/')).headers.location, '/login');
});

test('developer: sus tareas (vencidas marcadas), sus horas y los registros rechazados; no ve secciones de líder', async () => {
  const { app, db, mine, dev, dev2 } = setup();
  task(db, {
    project_id: mine,
    title: 'Atrasada',
    assignee_id: dev,
    status: 'in_progress',
    due_date: '2026-05-01',
  });
  task(db, {
    project_id: mine,
    title: 'Pendiente',
    assignee_id: dev,
    status: 'todo',
    due_date: '2026-05-30',
  });
  task(db, { project_id: mine, title: 'Terminada', assignee_id: dev, status: 'done' });
  task(db, { project_id: mine, title: 'De otra persona', assignee_id: dev2, status: 'todo' });
  timeEntry(db, {
    team_member_id: dev,
    project_id: mine,
    work_date: '2026-05-11',
    minutes: 480,
    status: 'draft',
  });
  timeEntry(db, {
    team_member_id: dev,
    project_id: mine,
    work_date: '2026-05-12',
    minutes: 240,
    status: 'submitted',
  });
  timeEntry(db, {
    team_member_id: dev,
    project_id: mine,
    work_date: '2026-05-04',
    minutes: 60,
    status: 'rejected',
    rejection_reason: 'Falta detalle',
  });
  const html = await home(app, 'dev');
  assert.match(html, /Hola, Ana/);
  assert.match(html, /12 h <span[^>]*>de 40 h/); // 8 + 4 h de la semana (la rechazada es de otra semana)
  assert.match(html, /1 sin enviar · 1 enviados/);
  assert.ok(html.indexOf('Atrasada') < html.indexOf('Pendiente'), 'las vencidas primero');
  assert.match(html, /Vencida/);
  assert.doesNotMatch(html, /Terminada|De otra persona/);
  assert.match(html, /Motivo: Falta detalle/);
  assert.doesNotMatch(html, /Horas por aprobar|Proyectos en riesgo|Tareas bloqueadas/);
});

test('pm: aprobaciones, riesgo, hitos y bloqueos solo de sus proyectos; sus propias horas no cuentan', async () => {
  const { app, db, mine, other, dev, lead } = setup();
  timeEntry(db, {
    team_member_id: dev,
    project_id: mine,
    work_date: '2026-05-11',
    status: 'submitted',
  });
  timeEntry(db, {
    team_member_id: dev,
    project_id: mine,
    work_date: '2026-05-12',
    status: 'submitted',
  });
  timeEntry(db, {
    team_member_id: lead,
    project_id: mine,
    work_date: '2026-05-12',
    status: 'submitted',
  }); // propia
  timeEntry(db, {
    team_member_id: dev,
    project_id: other,
    work_date: '2026-05-11',
    status: 'submitted',
  }); // ajena
  db.prepare("UPDATE projects SET end_date = '2026-05-01' WHERE id IN (?, ?)").run(mine, other); // ambos en riesgo
  milestone(db, { project_id: mine, name: 'Beta', due_date: '2026-05-10', status: 'pending' });
  milestone(db, { project_id: mine, name: 'Próximo', due_date: '2026-05-18', status: 'pending' });
  milestone(db, { project_id: mine, name: 'Lejano', due_date: '2026-09-01', status: 'pending' });
  milestone(db, { project_id: other, name: 'De otro', due_date: '2026-05-10', status: 'pending' });
  task(db, { project_id: mine, title: 'Bloqueada mía', status: 'blocked' });
  task(db, { project_id: other, title: 'Bloqueada ajena', status: 'blocked' });
  const html = await home(app, 'lead');
  assert.match(html, /Horas por aprobar<\/h2>\s*<p[^>]*>2</);
  assert.match(html, /PRJ-1 · Portal/);
  assert.doesNotMatch(html, /PRJ-2 · App móvil/);
  assert.match(html, /Beta/);
  assert.match(html, /Próximo/);
  assert.doesNotMatch(html, /Lejano|De otro/);
  assert.match(html, /Vencido/);
  assert.match(html, /Bloqueada mía/);
  assert.doesNotMatch(html, /Bloqueada ajena/);
});

test('admin: ve los proyectos en riesgo y las aprobaciones de todos', async () => {
  const { app, db, mine, other, dev } = setup();
  timeEntry(db, {
    team_member_id: dev,
    project_id: mine,
    work_date: '2026-05-11',
    status: 'submitted',
  });
  timeEntry(db, {
    team_member_id: dev,
    project_id: other,
    work_date: '2026-05-11',
    status: 'submitted',
  });
  db.prepare("UPDATE projects SET end_date = '2026-05-01' WHERE id IN (?, ?)").run(mine, other);
  const html = await home(app, 'admin');
  assert.match(html, /Horas por aprobar<\/h2>\s*<p[^>]*>2</);
  assert.match(html, /PRJ-1 · Portal/);
  assert.match(html, /PRJ-2 · App móvil/);
  assert.doesNotMatch(html, /Tus horas de la semana/); // sin miembro vinculado
});

test('viewer: proyectos activos con su avance y sin secciones de edición ni de horas', async () => {
  const { app, db, mine } = setup();
  task(db, { project_id: mine, title: 'Hecha', status: 'done', story_points: 3 });
  task(db, { project_id: mine, title: 'Abierta', status: 'todo', story_points: 5 });
  const html = await home(app, 'viewer');
  assert.match(html, /Proyectos activos/);
  assert.match(html, /PRJ-1 · Portal/);
  assert.match(html, /avance 38 %/); // 3 de 8 puntos
  assert.doesNotMatch(html, /Tus horas|Horas por aprobar|Tus tareas/);
  assert.match(html, /href="\/dashboard"/);
});

test('todos ven sus notificaciones sin leer (y solo las propias)', async () => {
  const { app, db, ids } = setup();
  db.prepare(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'x', 'Para Ana', 'detalle')",
  ).run(ids.dev);
  db.prepare(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'x', 'Para Beto', 'otro')",
  ).run(ids.dev2);
  const html = await home(app, 'dev');
  assert.match(html, /Para Ana/);
  assert.doesNotMatch(html, /Para Beto/);
  assert.match(html, /Notificaciones sin leer <span[^>]*>\(1\)/);
  assert.match(await home(app, 'lead'), /Estás al día/);
});

test('el contenido de usuarios se escapa en el panel (XSS)', async () => {
  const { app, db, mine, dev } = setup();
  task(db, {
    project_id: mine,
    title: '<script>alert(1)</script>',
    assignee_id: dev,
    status: 'todo',
  });
  const html = await home(app, 'dev');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('el panel se actualiza en vivo: contenedor data-live y script de la página', async () => {
  const { app } = setup();
  const html = await home(app, 'dev');
  assert.match(html, /data-home[^>]*data-live/);
  assert.match(html, /\/js\/pages\/home\.js/);
  assert.equal((await request(app).get('/js/pages/home.js')).status, 200);
});
