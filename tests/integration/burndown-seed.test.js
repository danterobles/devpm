import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { seed, SEED_PASSWORD } from '../../src/db/seeds/dev.js';
import { isWeekend, today } from '../../src/lib/dates.js';

// Criterio de cierre de la Etapa 9: el burndown del sprint activo del seed es correcto día a día.
let db;
let agent;
before(async () => {
  db = createTestDb();
  await seed(db, { timezone: 'America/Mexico_City' });
  const app = buildTestApp({ db });
  agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: 'viewer@devpm.local', password: SEED_PASSWORD });
});

test('cada sprint activo del seed: eje, ideal y real consistentes con sus instantáneas', async () => {
  const sprints = db.prepare("SELECT * FROM sprints WHERE status = 'active'").all();
  assert.ok(sprints.length >= 3);
  const now = today('America/Mexico_City');
  for (const sp of sprints) {
    const d = (await agent.get(`/api/v1/sprints/${sp.id}/burndown`)).body.data;
    assert.equal(d.days[0], sp.start_date);
    assert.ok(d.days.at(-1) >= sp.end_date);
    assert.equal(d.ideal.length, d.days.length);
    assert.equal(d.remaining.length, d.days.length);
    assert.equal(d.scopeChanges.length, d.days.length);

    // Ideal: parte del compromiso, termina en 0, nunca sube y los fines de semana repiten el valor previo.
    const firstBusiness = d.days.findIndex((day) => !isWeekend(day));
    assert.equal(d.ideal[firstBusiness], sp.committed_points);
    assert.equal(d.ideal[d.days.indexOf(sp.end_date)], 0);
    for (let i = 1; i < d.ideal.length; i += 1) {
      assert.ok(d.ideal[i] <= d.ideal[i - 1], `ideal no creciente en ${d.days[i]}`);
      if (isWeekend(d.days[i])) assert.equal(d.ideal[i], d.ideal[i - 1]);
    }

    // Real: coincide día a día con la instantánea guardada (o la arrastra) y no pasa de hoy.
    const rows = new Map(
      db
        .prepare('SELECT * FROM sprint_daily_snapshots WHERE sprint_id = ?')
        .all(sp.id)
        .map((r) => [r.snapshot_date, r]),
    );
    let previous = null;
    d.days.forEach((day, i) => {
      if (rows.has(day)) previous = rows.get(day);
      if (day > now) {
        assert.equal(d.remaining[i], null, `${day} es futuro`);
      } else if (previous) {
        assert.equal(d.remaining[i], previous.remaining_points, `real de ${day}`);
        assert.equal(d.total[i], previous.total_points);
        assert.equal(d.remaining[i], d.total[i] - previous.completed_points);
      }
    });

    // Hoy: el último punto real refleja el estado actual de las tareas del sprint.
    const current = db
      .prepare(
        "SELECT COALESCE(SUM(story_points), 0) FROM tasks WHERE sprint_id = ? AND status != 'done'",
      )
      .pluck()
      .get(sp.id);
    const lastIndex = d.remaining.findLastIndex((v) => v !== null);
    assert.equal(d.days[lastIndex] <= now, true);
    assert.equal(d.remaining[lastIndex], current, `restante de hoy del sprint ${sp.id}`);
  }
});

test('el burnup del seed termina en el alcance y lo completado actuales de sus sprints activos', async () => {
  const projects = db
    .prepare("SELECT DISTINCT project_id FROM sprints WHERE status = 'active'")
    .pluck()
    .all();
  for (const id of projects) {
    const d = (await agent.get(`/api/v1/projects/${id}/burnup`)).body.data;
    assert.ok(d.days.length > 0);
    const last = d.days.length - 1;
    assert.equal(d.scope[last] - d.completed[last], d.remaining[last]);
    const open = db
      .prepare(
        "SELECT COALESCE(SUM(story_points), 0) FROM tasks t JOIN sprints s ON s.id = t.sprint_id WHERE s.project_id = ? AND s.status = 'active' AND t.status != 'done'",
      )
      .pluck()
      .get(id);
    assert.ok(
      d.remaining[last] >= open,
      'lo pendiente incluye al menos lo abierto del sprint activo',
    );
  }
});
