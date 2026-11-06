import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { seed, SEED_PASSWORD } from '../../src/db/seeds/dev.js';

// Criterio de cierre de la Etapa 8: el Gantt refleja las tareas del seed y permite reprogramar con validación.
let db;
let app;
before(async () => {
  db = createTestDb();
  await seed(db, { timezone: 'America/Mexico_City' });
  app = buildTestApp({ db });
});
async function loginAs(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email, password: SEED_PASSWORD });
  return agent;
}

test('el Gantt de cada proyecto del seed refleja sus tareas, hitos y dependencias', async () => {
  const pm = await loginAs('pm@devpm.local');
  const projects = db
    .prepare("SELECT id FROM projects WHERE status IN ('active','on_hold','completed')")
    .pluck()
    .all();
  assert.ok(projects.length >= 4);
  let totalDrawn = 0;
  for (const id of projects) {
    const res = await pm.get(`/api/v1/projects/${id}/gantt`);
    assert.equal(res.status, 200);
    const { tasks, unscheduled } = res.body.data;
    const dated = db
      .prepare(
        'SELECT count(*) FROM tasks WHERE project_id = ? AND start_date IS NOT NULL AND due_date IS NOT NULL',
      )
      .pluck()
      .get(id);
    const undated =
      db.prepare('SELECT count(*) FROM tasks WHERE project_id = ?').pluck().get(id) - dated;
    const milestones = db
      .prepare('SELECT count(*) FROM milestones WHERE project_id = ?')
      .pluck()
      .get(id);
    assert.equal(
      tasks.filter((t) => t.meta.kind === 'task').length,
      dated,
      `tareas del proyecto ${id}`,
    );
    assert.equal(
      tasks.filter((t) => t.meta.kind === 'milestone').length,
      milestones,
      `hitos del proyecto ${id}`,
    );
    assert.equal(unscheduled.length, undated, `sin programar del proyecto ${id}`);
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) {
      assert.ok(t.progress >= 0 && t.progress <= 100);
      assert.ok(t.start <= t.end, `${t.name}: inicio ≤ fin`);
      assert.doesNotMatch(t.custom_class, /\s/);
      for (const dep of t.dependencies)
        assert.ok(ids.has(dep), `${t.name}: dependencia ${dep} dibujada`);
    }
    totalDrawn += tasks.length;
  }
  assert.ok(totalDrawn > 20);
  const portfolio = (await pm.get('/api/v1/gantt/portfolio')).body.data.projects;
  assert.equal(
    portfolio.length,
    db.prepare("SELECT count(*) FROM projects WHERE status = 'active'").pluck().get(),
  );
});

test('reprogramar con las dependencias del seed: respeta las válidas y rechaza las que las violan', async () => {
  const pm = await loginAs('pm@devpm.local');
  const edge = db
    .prepare(
      `SELECT d.task_id, d.depends_on_task_id, s.due_date AS pred_due, t.due_date AS task_due
         FROM task_dependencies d
         JOIN tasks t ON t.id = d.task_id JOIN tasks s ON s.id = d.depends_on_task_id
        WHERE t.start_date IS NOT NULL AND t.due_date IS NOT NULL AND s.due_date IS NOT NULL
          AND (SELECT status FROM sprints WHERE id = t.sprint_id) IS NOT 'closed'
        LIMIT 1`,
    )
    .get();
  assert.ok(edge, 'el seed tiene al menos una dependencia entre tareas con fechas');
  // Iniciar el mismo día que termina la predecesora viola fin-a-inicio.
  const bad = await pm
    .patch(`/api/v1/tasks/${edge.task_id}`)
    .send({ startDate: edge.pred_due, dueDate: edge.task_due });
  assert.equal(bad.status, 422);
  assert.match(bad.body.error.message, /después de que termine/);
  // Una tarea con dependencias y un hueco libre sí se mueve: un día después de la predecesora.
  const next = new Date(`${edge.pred_due}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = next.toISOString().slice(0, 10);
  const end = start > edge.task_due ? start : edge.task_due;
  const project = db
    .prepare(
      'SELECT p.start_date, p.end_date FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?',
    )
    .get(edge.task_id);
  if (start >= project.start_date && end <= project.end_date) {
    const ok = await pm
      .patch(`/api/v1/tasks/${edge.task_id}`)
      .send({ startDate: start, dueDate: end });
    assert.ok([200, 422].includes(ok.status)); // 422 solo si una sucesora lo impide
    if (ok.status === 422) assert.match(ok.body.error.message, /antes de que inicie/);
  }
  // Las tareas de sprints cerrados no se reprograman.
  const closed = db
    .prepare(
      "SELECT t.id, t.start_date, t.due_date FROM tasks t JOIN sprints s ON s.id = t.sprint_id WHERE s.status = 'closed' AND t.start_date IS NOT NULL LIMIT 1",
    )
    .get();
  assert.ok(closed);
  assert.equal(
    (
      await pm
        .patch(`/api/v1/tasks/${closed.id}`)
        .send({ startDate: closed.start_date, dueDate: closed.due_date, title: 'x' })
    ).status,
    422,
  );
});
