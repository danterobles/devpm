import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { createRemindersJob } from '../../src/jobs/reminders.js';
import { user, teamMember, project, task, timeEntry, milestone } from '../helpers/factories.js';

// Avisos periódicos (PRD §5.12.1): recordatorios de horas, vencimientos y riesgo.
const hash = bcrypt.hashSync('Secreta123!', 4);
afterEach(() => setClock(() => new Date()));

function setup(now = '2026-05-13T15:00:00Z') {
  setClock(() => new Date(now)); // 09:00 en Ciudad de México
  const db = createTestDb();
  const dev = teamMember(db, {
    first_name: 'Ana',
    last_name: 'Ruiz',
    weekly_capacity_minutes: 2400,
  });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  const ids = {
    admin: user(db, { email: 'admin@t.local', password_hash: hash, role: 'admin' }),
    lead: user(db, {
      email: 'lead@t.local',
      password_hash: hash,
      role: 'pm',
      team_member_id: lead,
    }),
    dev: user(db, {
      email: 'dev@t.local',
      password_hash: hash,
      role: 'developer',
      team_member_id: dev,
    }),
    viewer: user(db, { email: 'v@t.local', password_hash: hash, role: 'viewer' }),
  };
  const pid = project(db, {
    code: 'PRJ-1',
    name: 'Portal',
    status: 'active',
    manager_id: lead,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });
  const app = buildTestApp({ db });
  return { db, app, pid, dev, lead, ids, run: (d) => app.locals.reminders.run(d) };
}
/** Registra `minutes` por día en los días dados (cada registro admite hasta 1 440 min). */
const fill = (db, dev, pid, days, minutes, status = 'draft') =>
  days.forEach((d) =>
    timeEntry(db, { team_member_id: dev, project_id: pid, work_date: d, minutes, status }),
  );
const rows = (db, userId, type) =>
  db
    .prepare(
      'SELECT * FROM notifications WHERE user_id = ? AND (? IS NULL OR type = ?) ORDER BY id',
    )
    .all(userId, type ?? null, type ?? null);

test('miércoles: avisa a quien lleva menos del 50 % de su capacidad, una sola vez por semana', () => {
  const { db, ids, run } = setup();
  run('2026-05-13');
  const got = rows(db, ids.dev, 'hours_midweek');
  assert.equal(got.length, 1);
  assert.match(got[0].body, /Llevas 0 h de 40 h esta semana/);
  assert.equal(
    rows(db, ids.viewer).length,
    0,
    'un observador (sin miembro) no recibe recordatorios',
  );
  run('2026-05-13'); // idempotente
  assert.equal(rows(db, ids.dev, 'hours_midweek').length, 1);

  // con 25 h registradas (más del 50 %) ya no se avisa
  const s2 = setup();
  fill(s2.db, s2.dev, s2.pid, ['2026-05-11', '2026-05-12', '2026-05-13'], 480); // 24 h de 40
  s2.run('2026-05-13');
  assert.equal(rows(s2.db, s2.ids.dev, 'hours_midweek').length, 0);
});

test('viernes: avisa de registros sin enviar o de horas faltantes; no los demás días', () => {
  const draft = setup('2026-05-15T15:00:00Z');
  fill(
    draft.db,
    draft.dev,
    draft.pid,
    ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15'],
    480,
  );
  draft.run('2026-05-15');
  const a = rows(draft.db, draft.ids.dev, 'hours_close');
  assert.equal(a.length, 1);
  assert.equal(a[0].title, 'Envía tu semana');
  assert.match(a[0].body, /5 registro\(s\) sin enviar/);

  const low = setup('2026-05-15T15:00:00Z');
  low.run('2026-05-15');
  assert.equal(rows(low.db, low.ids.dev, 'hours_close')[0].title, 'Te faltan horas por registrar');

  const done = setup('2026-05-15T15:00:00Z');
  fill(
    done.db,
    done.dev,
    done.pid,
    ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15'],
    480,
    'approved',
  );
  done.run('2026-05-15');
  assert.equal(rows(done.db, done.ids.dev, 'hours_close').length, 0, 'semana completa y enviada');

  const tue = setup('2026-05-12T15:00:00Z');
  tue.run('2026-05-12');
  assert.equal(
    rows(tue.db, tue.ids.dev, 'hours_midweek').length +
      rows(tue.db, tue.ids.dev, 'hours_close').length,
    0,
  );
});

test('tareas vencidas: al responsable, una vez por tarea, solo si no están terminadas', () => {
  const { db, ids, dev, pid, run } = setup();
  const late = task(db, {
    project_id: pid,
    title: 'Atrasada',
    assignee_id: dev,
    status: 'in_progress',
    due_date: '2026-05-01',
  });
  task(db, {
    project_id: pid,
    title: 'Terminada',
    assignee_id: dev,
    status: 'done',
    due_date: '2026-05-01',
  });
  task(db, {
    project_id: pid,
    title: 'Futura',
    assignee_id: dev,
    status: 'todo',
    due_date: '2026-06-01',
  });
  task(db, { project_id: pid, title: 'Sin responsable', status: 'todo', due_date: '2026-05-01' });
  run('2026-05-13');
  run('2026-05-14');
  const got = rows(db, ids.dev, 'task_overdue');
  assert.equal(got.length, 1);
  assert.match(got[0].body, /«Atrasada» \(PRJ-1\) venció el 2026-05-01/);
  assert.equal(got[0].link, `/tasks/${late}`);
});

test('hitos vencidos: al líder del proyecto, una vez por hito', () => {
  const { db, ids, pid, run } = setup();
  milestone(db, {
    project_id: pid,
    name: 'Entrega beta',
    due_date: '2026-05-01',
    status: 'pending',
  });
  milestone(db, { project_id: pid, name: 'Cumplido', due_date: '2026-05-01', status: 'completed' });
  run('2026-05-13');
  run('2026-05-14');
  const got = rows(db, ids.lead, 'milestone_overdue');
  assert.equal(got.length, 1);
  assert.match(got[0].body, /«Entrega beta» \(PRJ-1\)/);
});

test('proyectos en riesgo: al líder, a lo más una vez por semana', () => {
  const { db, ids, pid, run } = setup();
  db.prepare("UPDATE projects SET end_date = '2026-05-01' WHERE id = ?").run(pid); // fecha fin vencida
  run('2026-05-13');
  run('2026-05-14'); // misma semana
  assert.equal(rows(db, ids.lead, 'project_at_risk').length, 1);
  assert.match(rows(db, ids.lead, 'project_at_risk')[0].body, /PRJ-1 · Portal/);
  run('2026-05-18'); // semana siguiente
  assert.equal(rows(db, ids.lead, 'project_at_risk').length, 2);
});

test('limpia las notificaciones leídas antiguas al ejecutarse', () => {
  const { db, ids, run } = setup();
  const old = db
    .prepare(
      "INSERT INTO notifications (user_id, type, title, body, read_at) VALUES (?, 'x', 't', 'b', '2026-01-01T00:00:00.000Z')",
    )
    .run(ids.dev).lastInsertRowid;
  const counts = run('2026-05-13');
  assert.equal(counts.pruned, 1);
  assert.equal(db.prepare('SELECT count(*) FROM notifications WHERE id = ?').pluck().get(old), 0);
});

test('el job corre al arrancar, se reprograma a las 09:00 y se detiene', () => {
  const calls = [];
  const timers = {
    setTimeout: (fn, ms) => {
      calls.push(ms);
      return { unref() {} };
    },
    clearTimeout: () => calls.push('clear'),
  };
  setClock(() => new Date('2026-05-13T14:00:00Z')); // 08:00 en CDMX → falta 1 h
  let runs = 0;
  const job = createRemindersJob({
    reminders: { run: () => ((runs += 1), {}) },
    timezone: 'America/Mexico_City',
    logger: { info() {}, error() {} },
    timers,
  });
  job.start();
  assert.equal(runs, 1);
  assert.equal(calls[0], 60 * 60 * 1000);
  job.stop();
  assert.equal(calls.at(-1), 'clear');
});

test('si el servicio falla el job lo registra y se reprograma', () => {
  const errors = [];
  const job = createRemindersJob({
    reminders: {
      run: () => {
        throw new Error('boom');
      },
    },
    timezone: 'America/Mexico_City',
    logger: { info() {}, error: (o) => errors.push(o) },
    timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
  });
  job.start();
  assert.equal(errors.length, 1);
});
