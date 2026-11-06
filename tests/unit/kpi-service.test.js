import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import { createKpiRepository } from '../../src/modules/dashboard/kpi.repository.js';
import { createKpiService } from '../../src/modules/dashboard/kpi.service.js';
import { DEFAULT_THRESHOLDS } from '../../src/modules/dashboard/thresholds.js';
import {
  teamMember,
  internalClient,
  externalClient,
  project,
  sprint,
  task,
  assignment,
  timeEntry,
} from '../helpers/factories.js';

const TODAY = '2026-05-13'; // miércoles
const RANGE = { from: '2026-05-11', to: '2026-05-15' }; // lunes a viernes

function setup() {
  const db = createTestDb();
  const service = createKpiService({ repository: createKpiRepository(db) });
  const kpi = (filters = RANGE, options = {}) =>
    service.getAll(filters, { today: TODAY, ...options });
  return { db, service, kpi };
}
const active = (db, o = {}) =>
  project(db, {
    status: 'active',
    start_date: '2026-05-01',
    end_date: '2026-05-31',
    budget_minutes: 0,
    ...o,
  });
const entry = (db, o) =>
  timeEntry(db, { work_date: '2026-05-12', minutes: 60, status: 'approved', ...o });

test('K1: proyectos activos y desglose por estado', () => {
  const { db, kpi } = setup();
  for (const status of ['planning', 'active', 'active', 'on_hold', 'completed', 'cancelled'])
    project(db, { status });
  const { k1 } = kpi().kpis;
  assert.equal(k1.value, 2);
  assert.deepEqual(k1.byStatus, { planning: 1, active: 2, on_hold: 1, completed: 1, cancelled: 1 });
});

test('K2: puntos done ÷ puntos totales de los proyectos activos (incluye subtareas; excluye otros estados)', () => {
  const { db, kpi } = setup();
  const p = active(db);
  const parent = task(db, { project_id: p, story_points: 5, status: 'done' });
  task(db, { project_id: p, story_points: 3, status: 'todo', parent_task_id: parent });
  task(db, { project_id: p, story_points: 2, status: 'in_progress' });
  task(db, { project_id: p, story_points: null, status: 'todo' }); // sin puntos
  const planning = project(db, { status: 'planning' });
  task(db, { project_id: planning, story_points: 21, status: 'todo' }); // no activo: no cuenta
  const { k2 } = kpi().kpis;
  assert.deepEqual(
    { value: k2.value, done: k2.donePoints, total: k2.totalPoints },
    { value: 50, done: 5, total: 10 },
  );
});

test('K2 sin puntos: null', () => {
  const { db, kpi } = setup();
  active(db);
  assert.equal(kpi().kpis.k2.value, null);
});

test('K3, K4 y K5 agregan EV/PV/AC sobre proyectos activos con presupuesto; el semáforo compara con el avance', () => {
  const { db, kpi } = setup();
  const dev = teamMember(db);
  // A: plan 1–31 de mayo → hoy (13) = 40 % transcurrido; avance 50 %; presupuesto 6000 min (100 h)
  const a = active(db, { budget_minutes: 6000 });
  task(db, { project_id: a, story_points: 5, status: 'done' });
  task(db, { project_id: a, story_points: 5, status: 'todo' });
  entry(db, { project_id: a, team_member_id: dev, minutes: 1000, status: 'approved' });
  entry(db, { project_id: a, team_member_id: dev, minutes: 500, status: 'approved' });
  entry(db, { project_id: a, team_member_id: dev, minutes: 500, status: 'submitted' });
  entry(db, { project_id: a, team_member_id: dev, minutes: 1440, status: 'draft' }); // no cuenta
  entry(db, {
    project_id: a,
    team_member_id: dev,
    minutes: 1440,
    status: 'rejected',
    rejection_reason: 'x',
  }); // no cuenta
  // B: plan 1–21 → 60 % transcurrido; avance 20 %; presupuesto 3000
  const b = active(db, { budget_minutes: 3000, end_date: '2026-05-21' });
  task(db, { project_id: b, story_points: 2, status: 'done' });
  task(db, { project_id: b, story_points: 8, status: 'todo' });
  entry(db, { project_id: b, team_member_id: dev, minutes: 1200, work_date: '2026-03-02' }); // fuera del rango: AC es acumulado
  // C: sin presupuesto → no participa en K3–K5
  const c = active(db, { budget_minutes: 0 });
  task(db, { project_id: c, story_points: 8, status: 'done' });
  const { k3, k4, k5 } = kpi().kpis;
  // EV = 0.5·6000 + 0.2·3000 = 3600; PV = 0.4·6000 + 0.6·3000 = 4200; AC = 2000 + 1200 = 3200
  assert.equal(k3.value, 0.86); // 3600 / 4200
  assert.equal(k4.value, 1.13); // 3600 / 3200
  assert.equal(k5.value, 35.6); // 3200 / 9000
  assert.equal(k4.earnedMinutes, 3600);
  assert.equal(k4.actualMinutes, 3200);
  assert.equal(k3.status, 'amber'); // 0.857 ∈ [0.85, 0.95)
  assert.equal(k4.status, 'green');
  // avance del conjunto: A(5/10) + B(2/10) + C(8/8) = 15/28 = 53.6 %
  assert.equal(kpi().kpis.k2.value, 53.6);
  assert.equal(k5.progress, 53.6);
  assert.equal(k5.status, 'green'); // 35.6 ≤ 53.6 + 10
});

test('K3/K4/K5 sin proyectos con presupuesto, sin horas o sin tiempo transcurrido: null', () => {
  const { db, kpi } = setup();
  active(db, { budget_minutes: 0 });
  const future = active(db, {
    budget_minutes: 600,
    start_date: '2026-06-01',
    end_date: '2026-06-30',
  }); // PV = 0
  task(db, { project_id: future, story_points: 3, status: 'done' });
  const { k3, k4, k5 } = kpi().kpis;
  assert.equal(k3.value, null);
  assert.equal(k4.value, null); // AC = 0
  assert.equal(k5.value, 0); // 0 horas ÷ presupuesto
  assert.equal(k3.status, null);
  assert.equal(k4.status, null);
});

test('K6: horas registradas ÷ capacidad (semanal ÷ 5 por día hábil, menos ausencias; miembros inactivos no cuentan)', () => {
  const { db, kpi } = setup();
  const m1 = teamMember(db, { weekly_capacity_minutes: 2400 });
  const m2 = teamMember(db, { weekly_capacity_minutes: 2400 });
  teamMember(db, { weekly_capacity_minutes: 2400, is_active: 0 });
  const p = active(db);
  // m2 está de vacaciones el miércoles 13 (1 día hábil)
  db.prepare(
    "INSERT INTO time_off (team_member_id, type, start_date, end_date) VALUES (?, 'vacation', '2026-05-13', '2026-05-13')",
  ).run(m2);
  // el fin de semana no descuenta
  db.prepare(
    "INSERT INTO time_off (team_member_id, type, start_date, end_date) VALUES (?, 'sick', '2026-05-16', '2026-05-17')",
  ).run(m1);
  entry(db, { project_id: p, team_member_id: m1, minutes: 1000, work_date: '2026-05-11' });
  entry(db, { project_id: p, team_member_id: m1, minutes: 1000, work_date: '2026-05-11' });
  entry(db, {
    project_id: p,
    team_member_id: m2,
    minutes: 1000,
    work_date: '2026-05-12',
    status: 'submitted',
  });
  entry(db, { project_id: p, team_member_id: m2, minutes: 500, work_date: '2026-05-20' }); // fuera del rango
  entry(db, {
    project_id: p,
    team_member_id: m2,
    minutes: 700,
    work_date: '2026-05-12',
    status: 'draft',
  }); // no cuenta
  const { k6 } = kpi().kpis;
  // capacidad = 2400 + (2400 − 480) = 4320; horas = 3000 → 69.4 %
  assert.equal(k6.capacityMinutes, 4320);
  assert.equal(k6.loggedMinutes, 3000);
  assert.equal(k6.value, 69.4);
  assert.equal(k6.status, 'amber'); // 60–75
});

test('K6 con filtro de proyecto: solo miembros asignados y horas de ese proyecto', () => {
  const { db, kpi } = setup();
  const m1 = teamMember(db);
  const m2 = teamMember(db); // sin asignación al proyecto filtrado
  const p1 = active(db);
  const p2 = active(db);
  assignment(db, {
    project_id: p1,
    team_member_id: m1,
    start_date: '2026-05-01',
    end_date: '2026-05-31',
  });
  assignment(db, {
    project_id: p2,
    team_member_id: m2,
    start_date: '2026-05-01',
    end_date: '2026-05-31',
  });
  entry(db, { project_id: p1, team_member_id: m1, minutes: 1200 });
  entry(db, { project_id: p2, team_member_id: m2, minutes: 1200 });
  const { k6 } = kpi({ ...RANGE, projectId: p1 }).kpis;
  assert.equal(k6.capacityMinutes, 2400); // solo m1
  assert.equal(k6.loggedMinutes, 1200);
  assert.equal(k6.value, 50);
  assert.equal(kpi().kpis.k6.capacityMinutes, 4800); // sin filtro: ambos
});

test('K6 sin capacidad (sin miembros activos): null', () => {
  const { db, kpi } = setup();
  active(db);
  assert.equal(kpi().kpis.k6.value, null);
});

test('K7: miembros que algún día hábil suman más de 100 % (día por día, 100 % exacto no cuenta)', () => {
  const { db, kpi } = setup();
  const over = teamMember(db);
  const exact = teamMember(db);
  const disjoint = teamMember(db);
  const weekend = teamMember(db);
  const p1 = active(db);
  const p2 = active(db);
  const a = (member, project_id, allocation_percent, start_date, end_date) =>
    assignment(db, {
      team_member_id: member,
      project_id,
      allocation_percent,
      start_date,
      end_date,
    });
  a(over, p1, 60, '2026-05-01', '2026-05-31');
  a(over, p2, 60, '2026-05-13', '2026-05-14'); // 120 % miércoles y jueves
  a(exact, p1, 60, '2026-05-01', '2026-05-31');
  a(exact, p2, 40, '2026-05-01', '2026-05-31'); // 100 %
  a(disjoint, p1, 70, '2026-05-01', '2026-05-12');
  a(disjoint, p2, 70, '2026-05-13', '2026-05-31'); // no coinciden ningún día
  a(weekend, p1, 70, '2026-05-01', '2026-05-31');
  a(weekend, p2, 70, '2026-05-16', '2026-05-17'); // solo se traslapan en fin de semana
  const { k7 } = kpi().kpis;
  assert.equal(k7.value, 1);
  assert.deepEqual(k7.members, [over]);
  assert.equal(k7.status, 'amber');
});

test('K7 ignora asignaciones de proyectos terminados y cuenta las de proyectos planeados', () => {
  const { db, kpi } = setup();
  const m = teamMember(db);
  const p1 = active(db);
  const planning = project(db, {
    status: 'planning',
    start_date: '2026-05-01',
    end_date: '2026-05-31',
  });
  const done = project(db, {
    status: 'completed',
    start_date: '2026-05-01',
    end_date: '2026-05-31',
  });
  const a = (project_id, pct) =>
    assignment(db, {
      team_member_id: m,
      project_id,
      allocation_percent: pct,
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    });
  a(p1, 60);
  a(done, 60); // no cuenta
  assert.equal(kpi().kpis.k7.value, 0);
  a(planning, 60);
  assert.equal(kpi().kpis.k7.value, 1);
});

test('K8 y K9: velocidad del último sprint cerrado, promedio de los 3 últimos y cumplimiento', () => {
  const { db, kpi } = setup();
  const p = active(db);
  const mk = (n, end, committed, completed) =>
    sprint(db, {
      project_id: p,
      name: `S${n}`,
      status: 'closed',
      start_date: '2026-01-05',
      end_date: end,
      committed_points: committed,
      completed_points: completed,
    });
  mk(1, '2026-02-13', 20, 10); // fuera de los 3 últimos
  mk(2, '2026-03-13', 30, 24);
  mk(3, '2026-04-10', 25, 25);
  mk(4, '2026-05-08', 40, 20);
  sprint(db, {
    project_id: p,
    status: 'active',
    start_date: '2026-05-11',
    end_date: '2026-05-22',
    committed_points: 99,
  }); // activo: no cuenta
  const { k8, k9 } = kpi().kpis;
  assert.equal(k8.value, 20);
  assert.deepEqual(
    k8.history.map((h) => [h.name, h.points]),
    [
      ['S4', 20],
      ['S3', 25],
      ['S2', 24],
    ],
  );
  assert.equal(k8.average, 23); // (20 + 25 + 24) / 3
  assert.ok(k8.history.every((h) => h.projectCode)); // para distinguir sprints con el mismo nombre
  assert.equal(k9.completedPoints, 69);
  assert.equal(k9.committedPoints, 95);
  assert.equal(k9.value, 72.6); // 69 / 95
  assert.equal(k9.status, 'amber');
});

test('K8/K9 sin sprints cerrados: null', () => {
  const { db, kpi } = setup();
  active(db);
  const { k8, k9 } = kpi().kpis;
  assert.deepEqual([k8.value, k8.average, k9.value, k9.status], [null, null, null, null]);
});

test('K10, K11 y K15: vencidas, bloqueadas e hitos vencidos al día de hoy en proyectos abiertos', () => {
  const { db, kpi } = setup();
  const p = active(db);
  const planning = project(db, { status: 'planning' });
  const done = project(db, { status: 'completed' });
  const t = (project_id, o) => task(db, { project_id, ...o });
  t(p, { status: 'todo', due_date: '2026-05-12' }); // vencida
  t(p, { status: 'blocked', due_date: '2026-05-01' }); // vencida y bloqueada
  t(p, { status: 'done', due_date: '2026-05-01' }); // terminada: no cuenta
  t(p, { status: 'todo', due_date: '2026-05-13' }); // vence hoy: aún no
  t(p, { status: 'todo', due_date: null });
  t(planning, { status: 'blocked', due_date: '2026-05-02' }); // planning cuenta
  t(done, { status: 'blocked', due_date: '2026-05-02' }); // proyecto terminado: no cuenta
  const ms = (project_id, due, status) =>
    db
      .prepare('INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, ?, ?, ?)')
      .run(project_id, 'H', due, status);
  ms(p, '2026-05-12', 'pending');
  ms(p, '2026-05-01', 'missed');
  ms(p, '2026-05-02', 'completed'); // cumplido: no cuenta
  ms(p, '2026-05-13', 'pending'); // vence hoy
  ms(done, '2026-05-01', 'pending'); // proyecto terminado
  const { k10, k11, k15 } = kpi().kpis;
  assert.deepEqual([k10.value, k10.status], [3, 'amber']);
  assert.deepEqual([k11.value, k11.status], [2, 'amber']);
  assert.deepEqual([k15.value, k15.status], [2, 'red']);
});

test('K12: ciclo promedio (días) de las tareas terminadas dentro del periodo', () => {
  const { db, kpi } = setup();
  const p = active(db);
  const t = (started, completed, o = {}) =>
    task(db, { project_id: p, status: 'done', started_at: started, completed_at: completed, ...o });
  t('2026-05-08T00:00:00.000Z', '2026-05-11T00:00:00.000Z'); // 3 días
  t('2026-05-13T00:00:00.000Z', '2026-05-14T00:00:00.000Z'); // 1 día
  t('2026-04-01T00:00:00.000Z', '2026-04-20T00:00:00.000Z'); // terminó antes del periodo
  t(null, '2026-05-12T00:00:00.000Z'); // sin inicio
  task(db, { project_id: p, status: 'in_progress', started_at: '2026-05-10T00:00:00.000Z' }); // no terminada
  const { k12 } = kpi().kpis;
  assert.equal(k12.value, 2);
  assert.equal(k12.tasks, 2);
  assert.equal(setup().kpi().kpis.k12.value, null);
});

test('K13: horas facturables vs. no facturables, por tipo de cliente; solo enviadas y aprobadas del periodo', () => {
  const { db, kpi } = setup();
  const ext = project(db, { client_id: externalClient(db), status: 'active' });
  const int = project(db, { client_id: internalClient(db), status: 'active' });
  entry(db, { project_id: ext, minutes: 600, is_billable: 1 });
  entry(db, { project_id: ext, minutes: 120, is_billable: 0, status: 'submitted' });
  entry(db, { project_id: int, minutes: 240, is_billable: 0 });
  entry(db, { project_id: int, minutes: 60, is_billable: 1 });
  entry(db, { project_id: ext, minutes: 1440, is_billable: 1, status: 'draft' }); // no cuenta
  entry(db, { project_id: ext, minutes: 1440, is_billable: 1, work_date: '2026-04-01' }); // fuera del periodo
  const { k13 } = kpi().kpis;
  assert.equal(k13.billableMinutes, 660);
  assert.equal(k13.nonBillableMinutes, 360);
  assert.deepEqual(k13.byClientType.external, { billableMinutes: 600, nonBillableMinutes: 120 });
  assert.deepEqual(k13.byClientType.internal, { billableMinutes: 60, nonBillableMinutes: 240 });
});

test('K14: ingreso estimado = horas facturables APROBADAS × tarifa, por moneda; oculto salvo includeRevenue', () => {
  const { db, kpi } = setup();
  const mxn = project(db, {
    client_id: externalClient(db, { hourly_rate_cents: 85000, currency: 'MXN' }),
    status: 'active',
  });
  const usd = project(db, {
    client_id: externalClient(db, { hourly_rate_cents: 10000, currency: 'USD' }),
    status: 'active',
  });
  const internal = project(db, { client_id: internalClient(db), status: 'active' });
  entry(db, { project_id: mxn, minutes: 90, is_billable: 1 }); // 1.5 h × 850.00 = 1275.00
  entry(db, { project_id: mxn, minutes: 600, is_billable: 1, status: 'submitted' }); // sin aprobar: no cuenta
  entry(db, { project_id: mxn, minutes: 600, is_billable: 0 }); // no facturable
  entry(db, { project_id: usd, minutes: 120, is_billable: 1 }); // 2 h × 100.00 = 200.00
  entry(db, { project_id: internal, minutes: 600, is_billable: 1 }); // interno: sin tarifa
  assert.equal(kpi().kpis.k14, undefined);
  const { k14 } = kpi(RANGE, { includeRevenue: true }).kpis;
  assert.deepEqual(k14.byCurrency, [
    { currency: 'MXN', cents: 127500 },
    { currency: 'USD', cents: 20000 },
  ]);
});

test('K16: horas de la semana actual (lunes a domingo) ÷ capacidad de la semana', () => {
  const { db, kpi } = setup();
  const m = teamMember(db, { weekly_capacity_minutes: 2400 });
  const p = active(db);
  entry(db, { project_id: p, team_member_id: m, minutes: 1200, work_date: '2026-05-11' });
  entry(db, { project_id: p, team_member_id: m, minutes: 1080, work_date: '2026-05-17' }); // domingo, misma semana
  entry(db, { project_id: p, team_member_id: m, minutes: 600, work_date: '2026-05-08' }); // semana anterior
  const { k16 } = kpi({ from: '2026-01-01', to: '2026-12-31' }).kpis; // el rango no afecta a K16
  assert.deepEqual(k16.week, { from: '2026-05-11', to: '2026-05-17' });
  assert.equal(k16.loggedMinutes, 2280);
  assert.equal(k16.capacityMinutes, 2400);
  assert.equal(k16.value, 95);
  assert.equal(k16.status, 'green');
});

test('periodo por defecto: últimos 30 días terminando hoy; los filtros from/to lo sustituyen', () => {
  const { db, service, kpi } = setup();
  const m = teamMember(db);
  const p = active(db);
  entry(db, { project_id: p, team_member_id: m, minutes: 60, work_date: '2026-04-14' }); // primer día del periodo (hoy − 29)
  entry(db, { project_id: p, team_member_id: m, minutes: 60, work_date: '2026-04-13' }); // un día antes
  const byDefault = service.getAll({}, { today: TODAY });
  assert.deepEqual(byDefault.range, { from: '2026-04-14', to: '2026-05-13' });
  assert.equal(byDefault.kpis.k6.loggedMinutes, 60);
  assert.equal(kpi({ from: '2026-04-01', to: '2026-04-30' }).kpis.k6.loggedMinutes, 120);
});

test('filtros: tipo de cliente, cliente, proyecto y líder', () => {
  const { db, kpi } = setup();
  const lead = teamMember(db);
  const extClient = externalClient(db);
  const intClient = internalClient(db);
  const a = project(db, { client_id: extClient, manager_id: lead, status: 'active' });
  const b = project(db, { client_id: intClient, status: 'active' });
  const c = project(db, { client_id: extClient, status: 'planning' });
  assert.equal(kpi({ ...RANGE, clientType: 'external' }).kpis.k1.value, 1);
  assert.equal(kpi({ ...RANGE, clientType: 'internal' }).kpis.k1.value, 1);
  assert.equal(kpi({ ...RANGE, clientId: extClient }).kpis.k1.byStatus.planning, 1);
  assert.equal(kpi({ ...RANGE, projectId: b }).kpis.k1.value, 1);
  assert.equal(kpi({ ...RANGE, managerId: lead }).kpis.k1.value, 1);
  assert.deepEqual(
    kpi({ ...RANGE, managerId: lead }).projects.map((p) => p.id),
    [a],
  );
  assert.equal(kpi({ ...RANGE, projectId: c }).kpis.k1.value, 0);
});

test('filtros sin resultados: KPIs en cero o null, sin errores', () => {
  const { db, kpi } = setup();
  active(db);
  const { kpis, projects, risk } = kpi({ ...RANGE, projectId: 99999 });
  assert.equal(kpis.k1.value, 0);
  assert.equal(kpis.k2.value, null);
  assert.equal(kpis.k3.value, null);
  assert.equal(kpis.k6.value, null); // sin miembros asignados no hay capacidad
  assert.deepEqual([kpis.k10.value, kpis.k11.value, kpis.k15.value], [0, 0, 0]);
  assert.deepEqual([projects, risk], [[], []]);
});

test('proyectos en riesgo (RF-94): SPI, CPI, fecha vencida, sobreconsumo y hito vencido', () => {
  const { db, kpi } = setup();
  const dev = teamMember(db);
  // SPI bajo: 50 % del plan transcurrido sin avance
  const slow = active(db, {
    code: 'P-SPI',
    start_date: '2026-05-01',
    end_date: '2026-05-25',
    budget_minutes: 6000,
  });
  task(db, { project_id: slow, story_points: 5, status: 'todo' });
  // CPI bajo y sobreconsumo: avance 11 %, ya gastó 80 % del presupuesto
  const costly = active(db, {
    code: 'P-CPI',
    start_date: '2026-05-01',
    end_date: '2026-06-30',
    budget_minutes: 1000,
  });
  task(db, { project_id: costly, story_points: 1, status: 'done' });
  task(db, { project_id: costly, story_points: 8, status: 'todo' });
  entry(db, { project_id: costly, team_member_id: dev, minutes: 800 });
  // Fecha vencida y hito vencido
  const late = active(db, { code: 'P-LATE', start_date: '2026-04-01', end_date: '2026-05-10' });
  db.prepare(
    "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'H', '2026-05-05', 'pending')",
  ).run(late);
  // Sano
  const healthy = active(db, {
    code: 'P-OK',
    start_date: '2026-05-01',
    end_date: '2026-06-30',
    budget_minutes: 6000,
  });
  task(db, { project_id: healthy, story_points: 5, status: 'done' });
  task(db, { project_id: healthy, story_points: 5, status: 'todo' });
  // Planeado (no es candidato a riesgo aunque esté vencido)
  project(db, { code: 'P-PLAN', status: 'planning', end_date: '2026-01-01' });
  const { risk, projects } = kpi();
  const causes = Object.fromEntries(risk.map((r) => [r.code, r.causes.map((c) => c.code)]));
  assert.deepEqual(causes, {
    'P-SPI': ['SPI'],
    'P-CPI': ['SPI', 'CPI', 'OVERSPEND'], // además va muy por detrás del calendario
    'P-LATE': ['OVERDUE', 'MILESTONE'],
  });
  assert.equal(projects.length, 4);
  assert.deepEqual(projects.find((p) => p.code === 'P-OK').causes, []);
  const row = projects.find((p) => p.code === 'P-CPI');
  assert.equal(row.progress, 11.1); // 1 de 9 puntos
  assert.equal(row.consumption, 80);
  assert.equal(row.cpi, 0.14); // EV = 111 min; AC = 800
  assert.ok(risk.every((r) => r.causes.every((c) => c.message)));
});

test('los umbrales configurables cambian semáforos y causas de riesgo', () => {
  const db = createTestDb();
  const strict = structuredClone(DEFAULT_THRESHOLDS);
  strict.k10 = { greenMax: 0, amberMax: 0 };
  const service = createKpiService({
    repository: createKpiRepository(db),
    getThresholds: () => strict,
  });
  const p = active(db);
  task(db, { project_id: p, status: 'todo', due_date: '2026-05-01' });
  assert.equal(service.getAll(RANGE, { today: TODAY }).kpis.k10.status, 'red'); // con los de fábrica sería ámbar
});
