import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { user, teamMember, internalClient, assignment } from '../helpers/factories.js';

// Criterio de cierre de la Etapa 6: un sprint se planea, ejecuta en Kanban y cierra correctamente.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

test('flujo completo: planear → iniciar → ejecutar en el tablero → cerrar', async () => {
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  user(db, { email: 'pm@test.local', password_hash: hash, role: 'pm' });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  const app = buildTestApp({ db });
  const login = async (email) => {
    const a = request.agent(app);
    await a.post('/login').type('form').send({ email, password: PASSWORD });
    return a;
  };
  const pm = await login('pm@test.local');
  const developer = await login('dev@test.local');

  // Proyecto con el developer asignado.
  const project = (
    await pm.post('/api/v1/projects').send({
      name: 'Portal',
      clientId: internalClient(db),
      startDate: '2026-01-05',
      endDate: '2026-12-18',
    })
  ).body.data;
  assignment(db, {
    project_id: project.id,
    team_member_id: dev,
    start_date: '2026-01-05',
    end_date: '2026-12-18',
  });

  // Planeación: sprint planeado y tareas en el backlog.
  const sprint = (
    await pm.post(`/api/v1/projects/${project.id}/sprints`).send({
      name: 'Sprint 1',
      goal: 'MVP',
      startDate: '2026-02-02',
      endDate: '2026-02-13',
    })
  ).body.data;
  const mk = async (title, storyPoints) =>
    (
      await pm
        .post(`/api/v1/projects/${project.id}/tasks`)
        .send({ title, storyPoints, assigneeId: dev })
    ).body.data.id;
  const [login1, perfil, reportes, fuera] = [
    await mk('Login', 5),
    await mk('Perfil', 3),
    await mk('Reportes', 8),
    await mk('Fuera', 13),
  ];
  for (const id of [login1, perfil, reportes]) {
    const res = await pm.patch(`/api/v1/tasks/${id}`).send({ sprintId: sprint.id });
    assert.equal(res.body.data.status, 'todo');
  }

  // Inicio: se comprometen los puntos de las tareas del sprint (5 + 3 + 8).
  const started = await pm.post(`/api/v1/sprints/${sprint.id}/start`).send({});
  assert.equal(started.body.data.status, 'active');
  assert.equal(started.body.data.committedPoints, 16);

  // Ejecución en el tablero: el developer mueve sus tareas.
  const move = (id, status) => developer.post(`/api/v1/tasks/${id}/status`).send({ status });
  assert.equal((await move(login1, 'in_progress')).status, 200);
  assert.equal((await move(login1, 'in_review')).status, 200);
  assert.equal((await move(login1, 'done')).status, 200);
  assert.equal((await move(perfil, 'in_progress')).status, 200);
  assert.equal((await move(fuera, 'in_progress')).status, 200); // suya, aunque esté en backlog

  const board = (await developer.get(`/api/v1/sprints/${sprint.id}/board`)).body.data;
  const col = (s) => board.columns.find((c) => c.status === s);
  assert.deepEqual(
    col('done').tasks.map((t) => t.title),
    ['Login'],
  );
  assert.deepEqual(
    col('in_progress').tasks.map((t) => t.title),
    ['Perfil'],
  );
  assert.deepEqual(
    col('todo').tasks.map((t) => t.title),
    ['Reportes'],
  );
  assert.equal(col('done').points, 5);

  // Cierre: solo cuentan los puntos de lo terminado; lo demás regresa al backlog.
  const closed = await pm.post(`/api/v1/sprints/${sprint.id}/close`).send({});
  assert.equal(closed.body.data.status, 'closed');
  assert.equal(closed.body.data.completedPoints, 5);
  assert.equal(closed.body.data.committedPoints, 16);
  const backlog = await pm.get(`/api/v1/projects/${project.id}/tasks?backlog=true`);
  assert.deepEqual(backlog.body.data.map((t) => [t.title, t.status]).sort(), [
    ['Fuera', 'in_progress'],
    ['Perfil', 'backlog'],
    ['Reportes', 'backlog'],
  ]);
  // El historial de Perfil muestra todo su recorrido.
  const history = (await pm.get(`/api/v1/tasks/${perfil}/history`)).body.data.map(
    (h) => h.toStatus,
  );
  assert.deepEqual(history, ['backlog', 'todo', 'in_progress', 'backlog']);
  // Lo hecho queda en el sprint cerrado, en solo lectura, y el sprint ya no admite cambios.
  assert.equal((await pm.patch(`/api/v1/tasks/${login1}`).send({ title: 'x' })).status, 422);
  assert.equal((await pm.patch(`/api/v1/sprints/${sprint.id}`).send({ name: 'x' })).status, 422);
});
