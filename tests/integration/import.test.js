import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, project, assignment, internalClient } from '../helpers/factories.js';

// Importación por CSV (RF-120 a RF-123).
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  const dev = teamMember(db, {
    first_name: 'Ana',
    last_name: 'Ruiz',
    email: 'ana.ruiz@empresa.com',
  });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const mk = (role, email, member = null) =>
    user(db, { email: `${email}@t.local`, password_hash: hash, role, team_member_id: member });
  mk('admin', 'admin');
  mk('pm', 'pm', lead);
  mk('developer', 'dev', dev);
  mk('viewer', 'viewer');
  const pid = project(db, {
    code: 'PRJ-1',
    name: 'Portal',
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
  const events = [];
  const eventBus = {
    emit: (type, payload) => events.push(type) && { type, ...payload },
    subscribe: () => () => {},
    listenerCount: () => 0,
  };
  return { db, pid, dev, events, app: buildTestApp({ db, eventBus }) };
}
async function loginAs(app, who) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${who}@t.local`, password: PASSWORD });
  return agent;
}
const post = (agent, body) => agent.post('/import').type('form').send(body);
const count = (db, table) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
// `setup` crea un proyecto y, con él, un cliente interno: es la línea base de clientes.
const BASE_CLIENTS = 1;

const CLIENTS = [
  'tipo,nombre,departamento,razon_social,rfc,tarifa_hora,moneda,correo_contacto',
  'interno,Finanzas,Contabilidad,,,,,',
  'externo,Grupo Aurora,,Grupo Aurora SA de CV,GAU010101AAA,950.50,mxn,contacto@aurora.example',
].join('\n');

test('permisos: solo admin y pm; sin sesión redirige; developer y viewer reciben 403', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/import')).headers.location, '/login');
  for (const who of ['dev', 'viewer']) {
    const agent = await loginAs(app, who);
    assert.equal((await agent.get('/import')).status, 403, who);
    assert.equal(
      (await post(agent, { entity: 'clients', csv: CLIENTS, action: 'import' })).status,
      403,
      who,
    );
    assert.equal((await agent.get('/import/template/clients.csv')).status, 403, who);
  }
  for (const who of ['admin', 'pm'])
    assert.equal((await (await loginAs(app, who)).get('/import')).status, 200);
});

test('plantillas: una por entidad, con BOM, encabezados y una fila de ejemplo', async () => {
  const { app } = setup();
  const admin = await loginAs(app, 'admin');
  for (const [entity, first] of [
    ['clients', 'tipo'],
    ['members', 'nombre'],
    ['tasks', 'titulo'],
  ]) {
    const res = await admin.get(`/import/template/${entity}.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], new RegExp(`plantilla-${entity}\\.csv`));
    assert.equal(res.text.charCodeAt(0), 0xfeff);
    assert.equal(res.text.slice(1).split(/\r?\n/)[0].split(',')[0], first);
    assert.equal(res.text.trim().split(/\r?\n/).length, 2);
  }
  assert.equal((await admin.get('/import/template/otra.csv')).status, 400);
});

test('validar no guarda nada y muestra cada fila como correcta', async () => {
  const { app, db, events } = setup();
  const before = count(db, 'clients');
  const res = await post(await loginAs(app, 'admin'), {
    entity: 'clients',
    csv: CLIENTS,
    action: 'validate',
  });
  assert.equal(res.status, 200);
  assert.match(res.text, /2 fila\(s\): 2 correcta\(s\), 0 con errores/);
  assert.match(res.text, /Importar 2 fila\(s\)/);
  assert.equal(count(db, 'clients'), before);
  assert.equal(count(db, 'audit_log'), 0);
  assert.deepEqual(
    events.filter((e) => e.startsWith('client')),
    [],
    'la validación no emite eventos',
  );
});

test('importar clientes: crea todos con sus reglas, bitácora y eventos tras confirmar', async () => {
  const { app, db, events } = setup();
  const admin = await loginAs(app, 'admin');
  const res = await post(admin, { entity: 'clients', csv: CLIENTS, action: 'import' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/import?done=2&entity=clients');
  const ext = db.prepare("SELECT * FROM clients WHERE name = 'Grupo Aurora'").get();
  assert.equal(ext.type, 'external');
  assert.equal(ext.hourly_rate_cents, 95050);
  assert.equal(ext.currency, 'MXN');
  assert.equal(
    db.prepare("SELECT department FROM clients WHERE name = 'Finanzas'").pluck().get(),
    'Contabilidad',
  );
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'client'").pluck().get(),
    2,
  );
  assert.equal(events.filter((e) => e === 'client.updated').length, 2);
  assert.match(
    (await admin.get(res.headers.location)).text,
    /Se importaron <strong>2<\/strong> registro\(s\) de «Clientes»/,
  );
});

test('todo o nada: una fila con errores impide guardar las demás y se explica por columna', async () => {
  const { app, db, events } = setup();
  const csv = [
    'tipo,nombre,departamento,razon_social,tarifa_hora,correo_contacto',
    'interno,Buena,TI,,,',
    'externo,Sin razón,,, 100,',
    'interno,Sin depto,,,,',
    'raro,Tipo malo,,,,',
    'externo,Tarifa mala,,Razón SA,abc,',
    'interno,Correo malo,TI,,,no-es-correo',
  ].join('\n');
  const res = await post(await loginAs(app, 'pm'), { entity: 'clients', csv, action: 'import' });
  assert.equal(res.status, 422);
  assert.match(res.text, /6 fila\(s\): 1 correcta\(s\), 5 con errores/);
  assert.match(res.text, /razon_social: Campo obligatorio/);
  assert.match(res.text, /departamento: Campo obligatorio/);
  assert.match(res.text, /tipo: Debe ser «interno» o «externo»/);
  assert.match(res.text, /tarifa_hora: Tarifa inválida/);
  assert.match(res.text, /correo_contacto: Correo inválido/);
  assert.equal(count(db, 'clients'), BASE_CLIENTS);
  assert.equal(count(db, 'audit_log'), 0);
  assert.equal(events.filter((e) => e.startsWith('client')).length, 0);
});

test('duplicados: contra la base de datos y entre filas del mismo archivo', async () => {
  const { app, db } = setup();
  internalClient(db, { name: 'Finanzas' });
  const csv = [
    'tipo,nombre,departamento',
    'interno,finanzas,TI',
    'interno,Nueva,TI',
    'interno,NUEVA,TI',
  ].join('\n');
  const res = await post(await loginAs(app, 'admin'), {
    entity: 'clients',
    csv,
    action: 'validate',
  });
  assert.match(res.text, /Ya existe un cliente interno llamado «finanzas»/);
  assert.match(res.text, /Ya existe un cliente interno llamado «NUEVA»/);
  assert.match(res.text, /3 fila\(s\): 1 correcta\(s\), 2 con errores/);
  assert.equal(count(db, 'clients'), BASE_CLIENTS + 1);
});

test('importar miembros: capacidad y costo por defecto, correo duplicado y valores inválidos', async () => {
  const { app, db, events } = setup();
  const admin = await loginAs(app, 'admin');
  const ok = [
    'nombre;apellido;correo;puesto;nivel;horas_semana;costo_hora;fecha_ingreso', // punto y coma
    'Beto;Luna;BETO@empresa.com;qa;mid;32;350,50;2026-02-02',
    'Carla;Soto;carla@empresa.com;devops;senior;;;',
  ].join('\n');
  const res = await post(admin, { entity: 'members', csv: ok, action: 'import' });
  assert.equal(res.headers.location, '/import?done=2&entity=members');
  const beto = db.prepare("SELECT * FROM team_members WHERE email = 'beto@empresa.com'").get();
  assert.equal(beto.weekly_capacity_minutes, 1920);
  assert.equal(beto.hourly_cost_cents, 35050);
  const carla = db.prepare("SELECT * FROM team_members WHERE email = 'carla@empresa.com'").get();
  assert.equal(carla.weekly_capacity_minutes, 2400);
  assert.equal(carla.hourly_cost_cents, 0);
  assert.equal(events.filter((e) => e === 'team_member.updated').length, 2);

  const bad = [
    'nombre,apellido,correo,puesto,nivel,horas_semana,costo_hora',
    'Dup,Licado,ana.ruiz@empresa.com,qa,mid,,',
    'Mal,Puesto,mal@empresa.com,chef,mid,,',
    'Mal,Horas,horas@empresa.com,qa,mid,mucho,',
    'Mal,Costo,costo@empresa.com,qa,mid,,-5',
  ].join('\n');
  const res2 = await post(admin, { entity: 'members', csv: bad, action: 'validate' });
  assert.match(res2.text, /correo|email|ya está registrado/i);
  assert.match(res2.text, /puesto: Puesto inválido/);
  assert.match(res2.text, /horas_semana: Horas semanales inválidas/);
  assert.match(res2.text, /costo_hora: Costo por hora inválido/);
  assert.equal(count(db, 'team_members'), 4); // Ana, Lía + 2 importados
});

test('importar tareas: al backlog del proyecto, con responsable por correo asignado al proyecto', async () => {
  const { app, db, pid, dev, events } = setup();
  const admin = await loginAs(app, 'admin');
  const csv = [
    'titulo,tipo,prioridad,puntos,estimacion_horas,responsable_correo,fecha_inicio,fecha_fin',
    'Diseñar modelo,feature,high,5,8,ana.ruiz@empresa.com,2026-06-01,2026-06-05',
    'Corregir error,bug,,3,2.5,,,',
  ].join('\n');
  const res = await post(admin, { entity: 'tasks', csv, projectId: String(pid), action: 'import' });
  assert.equal(res.headers.location, '/import?done=2&entity=tasks');
  const t = db.prepare("SELECT * FROM tasks WHERE title = 'Diseñar modelo'").get();
  assert.equal(t.project_id, pid);
  assert.equal(t.status, 'backlog');
  assert.equal(t.assignee_id, dev);
  assert.equal(t.story_points, 5);
  assert.equal(t.estimated_minutes, 480);
  assert.equal(
    db.prepare("SELECT priority FROM tasks WHERE title = 'Corregir error'").pluck().get(),
    'medium',
  );
  assert.equal(events.filter((e) => e === 'task.created').length, 2);
  assert.equal(count(db, 'notifications'), 0, 'una carga masiva no avisa tarea por tarea');
});

test('tareas: errores de responsable, puntos, fechas y proyecto; sin proyecto no hay importación', async () => {
  const { app, db, pid } = setup();
  const admin = await loginAs(app, 'admin');
  const csv = [
    'titulo,puntos,estimacion_horas,responsable_correo,fecha_inicio,fecha_fin',
    'Sin responsable real,3,,nadie@empresa.com,,',
    'Puntos malos,4,,,,',
    'Estimación mala,,mucho,,,',
    'Fechas al revés,,,,2026-06-10,2026-06-01',
    'Fuera del proyecto,,,,2027-01-01,2027-01-05',
  ].join('\n');
  const res = await post(admin, {
    entity: 'tasks',
    csv,
    projectId: String(pid),
    action: 'validate',
  });
  assert.match(res.text, /responsable_correo: No existe un miembro con ese correo/);
  assert.match(res.text, /puntos: Puntos inválidos/);
  assert.match(res.text, /estimacion_horas: Estimación en horas inválida/);
  assert.match(res.text, /fecha_fin: La fecha de fin no puede ser anterior/);
  assert.match(res.text, /5 con errores/);
  assert.equal(count(db, 'tasks'), 0);
  const noProject = await post(admin, { entity: 'tasks', csv, action: 'validate' });
  assert.match(noProject.text, /Elige el proyecto/);
  const ghost = await post(admin, { entity: 'tasks', csv, projectId: '9999', action: 'import' });
  assert.equal(ghost.status, 400);
  assert.equal(count(db, 'tasks'), 0);
});

test('tareas: un responsable que no está asignado al proyecto se rechaza con la regla de negocio', async () => {
  const { app, db, pid } = setup();
  teamMember(db, { first_name: 'Sin', last_name: 'Asignar', email: 'sin@empresa.com' });
  const csv = 'titulo,responsable_correo\nTarea,sin@empresa.com\n';
  const res = await post(await loginAs(app, 'admin'), {
    entity: 'tasks',
    csv,
    projectId: String(pid),
    action: 'validate',
  });
  assert.match(res.text, /1 con errores/);
  assert.equal(count(db, 'tasks'), 0);
});

test('archivo inválido: sin columnas obligatorias, vacío, sin filas o con demasiadas filas', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin');
  const run = (csv) => post(admin, { entity: 'clients', csv, action: 'validate' });
  assert.match((await run('nombre\nX')).text, /Faltan columnas obligatorias: tipo/);
  assert.match((await run('')).text, /Carga un archivo CSV/);
  assert.match((await run('tipo,nombre\n')).text, /no tiene filas de datos/);
  const many =
    'tipo,nombre,departamento\n' +
    Array.from({ length: 1001 }, (_, i) => `interno,C${i},TI`).join('\n');
  assert.match((await run(many)).text, /tiene 1001 filas; el máximo es 1000/);
  assert.equal(count(db, 'clients'), BASE_CLIENTS);
  assert.equal((await post(admin, { entity: 'otra', csv: 'a', action: 'validate' })).status, 400);
});

test('1 000 filas válidas se importan completas; las columnas desconocidas se ignoran', async () => {
  const { app, db } = setup();
  const csv =
    'tipo,nombre,departamento,extra\n' +
    Array.from({ length: 1000 }, (_, i) => `interno,Cliente ${i},TI,x`).join('\n');
  const admin = await loginAs(app, 'admin');
  const preview = await post(admin, { entity: 'clients', csv, action: 'validate' });
  assert.match(preview.text, /Columnas ignoradas: extra/);
  const res = await post(admin, { entity: 'clients', csv, action: 'import' });
  assert.equal(res.headers.location, '/import?done=1000&entity=clients');
  assert.equal(count(db, 'clients'), BASE_CLIENTS + 1000);
});

test('el contenido del archivo se escapa al mostrarlo (XSS) y las fórmulas se guardan como texto', async () => {
  const { app, db } = setup();
  const csv = 'tipo,nombre,departamento\ninterno,"<script>alert(1)</script>",\n';
  const res = await post(await loginAs(app, 'admin'), {
    entity: 'clients',
    csv,
    action: 'validate',
  });
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
  assert.match(res.text, /&lt;script&gt;/);
  const formula = 'tipo,nombre,departamento\ninterno,=HYPERLINK("x"),TI\n';
  await post(await loginAs(app, 'admin'), { entity: 'clients', csv: formula, action: 'import' });
  assert.equal(
    db.prepare("SELECT name FROM clients WHERE name LIKE '%HYPERLINK%'").pluck().get(),
    '=HYPERLINK("x")',
  );
});

test('la importación aparece en el menú solo para admin y pm', async () => {
  const { app } = setup();
  for (const [who, shown] of [
    ['admin', true],
    ['pm', true],
    ['dev', false],
    ['viewer', false],
  ])
    assert.equal(
      (await (await loginAs(app, who)).get('/projects')).text.includes('href="/import"'),
      shown,
      who,
    );
});
