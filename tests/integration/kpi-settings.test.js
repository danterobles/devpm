import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { createEventBus } from '../../src/realtime/eventBus.js';
import { setClock } from '../../src/lib/dates.js';
import { DEFAULT_THRESHOLDS } from '../../src/modules/dashboard/thresholds.js';
import { user, project, task } from '../helpers/factories.js';

const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

function setup() {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    user(db, { email: `${role}@test.local`, password_hash: hash, role });
  }
  const bus = createEventBus();
  const events = [];
  bus.subscribe((e) => events.push(e));
  return { db, events, app: buildTestApp({ db, eventBus: bus }) };
}
async function loginAs(app, role) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: `${role}@test.local`, password: PASSWORD });
  return agent;
}
const URL = '/api/v1/settings/kpi-thresholds';
const custom = (patch) => ({ ...structuredClone(DEFAULT_THRESHOLDS), ...patch });

test('lectura: 401 sin sesión; cualquier rol ve los umbrales; por defecto son los del PRD', async () => {
  const { app } = setup();
  assert.equal((await request(app).get(URL)).status, 401);
  for (const role of ['admin', 'pm', 'developer', 'viewer']) {
    const res = await (await loginAs(app, role)).get(URL);
    assert.equal(res.status, 200, role);
    assert.deepEqual(res.body.data.thresholds, DEFAULT_THRESHOLDS);
    assert.equal(res.body.data.isDefault, true);
  }
});

test('escritura: solo admin (pm, developer y viewer 403); 401 sin sesión', async () => {
  const { app } = setup();
  const body = custom({ k10: { greenMax: 1, amberMax: 8 } });
  assert.equal((await request(app).put(URL).send(body)).status, 401);
  for (const role of ['pm', 'developer', 'viewer']) {
    const a = await loginAs(app, role);
    assert.equal((await a.put(URL).send(body)).status, 403, role);
    assert.equal((await a.delete(URL)).status, 403, role);
  }
});

test('admin guarda los umbrales: se persisten en settings, cambian los semáforos y se emite el evento', async () => {
  const { app, db, events } = setup();
  const p = project(db, { status: 'active' });
  for (let i = 0; i < 3; i += 1)
    task(db, { project_id: p, status: 'todo', due_date: '2026-05-01' });
  const admin = await loginAs(app, 'admin');
  const viewer = await loginAs(app, 'viewer');
  const k10 = async () => (await viewer.get('/api/v1/dashboard/kpis')).body.data.kpis.k10;
  assert.equal((await k10()).status, 'amber'); // 3 vencidas con los umbrales de fábrica (1–5)
  const res = await admin.put(URL).send(custom({ k10: { greenMax: 3, amberMax: 8 } }));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.isDefault, false);
  assert.deepEqual(res.body.data.thresholds.k10, { greenMax: 3, amberMax: 8 });
  assert.equal((await k10()).status, 'green'); // ahora 3 ≤ 3
  const stored = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key = 'kpi.thresholds'").pluck().get(),
  );
  assert.deepEqual(stored.k10, { greenMax: 3, amberMax: 8 });
  assert.equal((await viewer.get(URL)).body.data.thresholds.k10.greenMax, 3);
  assert.deepEqual(
    events.map((e) => e.type),
    ['settings.updated'],
  );
});

test('los umbrales también cambian las causas de «proyectos en riesgo»', async () => {
  const { app, db } = setup();
  project(db, {
    status: 'active',
    code: 'P-1',
    start_date: '2026-05-01',
    end_date: '2026-05-31',
    budget_minutes: 6000,
  });
  db.prepare(
    "INSERT INTO tasks (project_id, title, story_points, status) VALUES (1, 'T', 5, 'todo')",
  ).run();
  const admin = await loginAs(app, 'admin');
  const risk = async () => (await admin.get('/api/v1/dashboard/kpis')).body.data.risk;
  assert.deepEqual(
    (await risk()).map((r) => r.code),
    ['P-1'],
  ); // SPI 0 < 0.85
  await admin.put(URL).send(custom({ k3: { green: 0.05, amber: 0 } }));
  assert.deepEqual(await risk(), []); // con amber = 0 el SPI ya no es «bajo»
});

test('queda en bitácora con el antes y el después; sin cambios no se registra', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin');
  const next = custom({ k11: { greenMax: 1, amberMax: 4 } });
  await admin.put(URL).send(next);
  await admin.put(URL).send(next); // idéntico
  const rows = db.prepare("SELECT action, changes FROM audit_log WHERE entity = 'settings'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'update');
  assert.deepEqual(JSON.parse(rows[0].changes)['kpi.thresholds.k11'], [
    { greenMax: 0, amberMax: 3 },
    { greenMax: 1, amberMax: 4 },
  ]);
});

test('validación: estructura estricta, números y orden coherente de cada umbral', async () => {
  const { app } = setup();
  const admin = await loginAs(app, 'admin');
  const bad = [
    {}, // faltan KPIs
    custom({ k99: { green: 1, amber: 0 } }), // clave desconocida
    custom({ k3: { green: 0.9, amber: 0.95 } }), // verde por debajo del ámbar
    custom({ k3: { green: 'alto', amber: 0.85 } }),
    custom({ k3: { green: 0.95 } }), // falta amber
    custom({ k5: { greenMargin: 30, amberMargin: 20 } }), // margen verde > ámbar
    custom({ k5: { greenMargin: -1, amberMargin: 20 } }),
    custom({ k6: { greenMin: 75, greenMax: 95, amberMin: 80, amberMax: 105 } }), // banda ámbar no envuelve la verde
    custom({ k6: { greenMin: 75, greenMax: 95, amberMin: 60, amberMax: 90 } }),
    custom({ k7: { greenMax: 3, amberMax: 2 } }), // verde > ámbar
    custom({ k10: { greenMax: -1, amberMax: 5 } }),
    custom({ k9: { green: 150, amber: 70 } }), // porcentaje > 100
    custom({ k10: { greenMax: 0, amberMax: 5, extra: 1 } }),
  ];
  for (const body of bad) {
    const res = await admin.put(URL).send(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  assert.deepEqual((await admin.get(URL)).body.data.thresholds, DEFAULT_THRESHOLDS); // nada se guardó
});

test('restablecer: DELETE vuelve a los valores del PRD, emite evento y deja bitácora', async () => {
  const { app, db, events } = setup();
  const admin = await loginAs(app, 'admin');
  await admin.put(URL).send(custom({ k15: { greenMax: 2, amberMax: 4 } }));
  events.length = 0;
  const res = await admin.delete(URL);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.thresholds, DEFAULT_THRESHOLDS);
  assert.equal(res.body.data.isDefault, true);
  assert.equal(
    db.prepare("SELECT count(*) FROM settings WHERE key = 'kpi.thresholds'").pluck().get(),
    0,
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ['settings.updated'],
  );
  assert.equal(
    db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'settings'").pluck().get(),
    2,
  );
  events.length = 0;
  await admin.delete(URL); // ya estaba por defecto: sin evento
  assert.deepEqual(events, []);
});

test('valores guardados corruptos o incompletos no rompen el tablero: se usan los de fábrica', async () => {
  const { app, db } = setup();
  const viewer = await loginAs(app, 'viewer');
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (\'kpi.thresholds\', \'{"k10": {"greenMax": "mucho"}}\')',
  ).run();
  const res = await viewer.get('/api/v1/dashboard/kpis');
  assert.equal(res.status, 200);
  assert.deepEqual((await viewer.get(URL)).body.data.thresholds, DEFAULT_THRESHOLDS);
  db.prepare(
    'UPDATE settings SET value = \'{"k10": {"greenMax": 2, "amberMax": 6}}\' WHERE key = \'kpi.thresholds\'',
  ).run();
  const merged = (await viewer.get(URL)).body.data.thresholds; // incompleto pero válido: se completa con los de fábrica
  assert.deepEqual(merged.k10, { greenMax: 2, amberMax: 6 });
  assert.deepEqual(merged.k3, DEFAULT_THRESHOLDS.k3);
});

test('página /admin/settings/kpis: solo admin; formulario con los valores y botón de restablecer', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/admin/settings/kpis')).status, 302);
  for (const role of ['pm', 'developer', 'viewer']) {
    assert.equal((await (await loginAs(app, role)).get('/admin/settings/kpis')).status, 403, role);
  }
  const page = await (await loginAs(app, 'admin')).get('/admin/settings/kpis');
  assert.equal(page.status, 200);
  assert.match(page.text, /Umbrales de los KPIs/);
  assert.match(page.text, /name="k3\.green"[^>]*value="0\.95"/);
  assert.match(page.text, /name="k6\.amberMax"[^>]*value="105"/);
  assert.match(page.text, /name="k10\.greenMax"[^>]*value="0"/);
  assert.match(page.text, /action="\/admin\/settings\/kpis\/reset"/);
});

test('página: guardar por formulario, errores en el formulario y restablecer', async () => {
  const { app, db } = setup();
  const admin = await loginAs(app, 'admin');
  const flat = (t) => {
    const out = {};
    for (const [kpi, fields] of Object.entries(t))
      for (const [k, v] of Object.entries(fields)) out[`${kpi}.${k}`] = String(v);
    return out;
  };
  const ok = await admin
    .post('/admin/settings/kpis')
    .type('form')
    .send(flat(custom({ k10: { greenMax: 2, amberMax: 9 } })));
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/admin/settings/kpis?saved=1');
  assert.deepEqual(
    JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'kpi.thresholds'").pluck().get())
      .k10,
    { greenMax: 2, amberMax: 9 },
  );
  assert.match((await admin.get('/admin/settings/kpis?saved=1')).text, /Umbrales guardados/);

  const bad = await admin
    .post('/admin/settings/kpis')
    .type('form')
    .send(flat(custom({ k7: { greenMax: 5, amberMax: 1 } })));
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<form/);
  assert.match(bad.text, /name="k7\.greenMax"[^>]*value="5"/); // conserva lo escrito
  const nan = await admin
    .post('/admin/settings/kpis')
    .type('form')
    .send({ ...flat(DEFAULT_THRESHOLDS), 'k3.green': 'abc' });
  assert.equal(nan.status, 400);

  const reset = await admin.post('/admin/settings/kpis/reset').type('form').send({});
  assert.equal(reset.status, 302);
  assert.equal(
    db.prepare("SELECT count(*) FROM settings WHERE key = 'kpi.thresholds'").pluck().get(),
    0,
  );
  const pm = await loginAs(app, 'pm');
  assert.equal((await pm.post('/admin/settings/kpis').type('form').send({})).status, 403);
});

test('el tablero enlaza la configuración solo para admin', async () => {
  const { app } = setup();
  assert.match(
    (await (await loginAs(app, 'admin')).get('/dashboard')).text,
    /href="\/admin\/settings\/kpis"/,
  );
  assert.doesNotMatch(
    (await (await loginAs(app, 'pm')).get('/dashboard')).text,
    /\/admin\/settings\/kpis/,
  );
});
