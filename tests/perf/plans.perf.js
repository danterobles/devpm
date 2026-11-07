// Revisión de EXPLAIN QUERY PLAN (Etapa 11): ejecuta los flujos principales con el volumen de RNF-01,
// captura las consultas SELECT con sus parámetros y falla si alguna recorre completa una tabla grande
// (SCAN sin índice). Se ejecuta con `npm run test:perf`.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { loadVolume } from './volume.js';

// Tablas que crecen sin límite: ninguna consulta debe recorrerlas completas. (`tasks` y `assignments`
// tienen miles de filas como mucho y a veces se leen casi enteras, p. ej. K10 sobre 44 de 50 proyectos.)
const BIG_TABLES = [
  'time_entries',
  'task_status_history',
  'audit_log',
  'sprint_daily_snapshots',
  'task_dependencies',
  'time_off',
  'sessions',
];
const captured = new Map(); // sql → argumentos de la primera ejecución
let db;

before(async () => {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  db = createTestDb();
  const sample = loadVolume(db);
  db.exec('ANALYZE'); // estadísticas reales, como las tendría una BD en uso
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = original(sql);
    if (/^\s*(SELECT|WITH)/i.test(sql)) {
      for (const method of ['all', 'get']) {
        const run = statement[method].bind(statement);
        statement[method] = (...args) => {
          if (!captured.has(sql)) captured.set(sql, args);
          return run(...args);
        };
      }
    }
    return statement;
  };
  const app = buildTestApp({ db });
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: 'admin@perf.local', password: 'Secreta123!' });
  const sprint = db.prepare("SELECT id FROM sprints WHERE status = 'active' LIMIT 1").pluck().get();
  const project = sample.projectIds[1];
  const member = db.prepare('SELECT id FROM team_members LIMIT 1').pluck().get();
  const task = db.prepare('SELECT id FROM tasks WHERE project_id = ? LIMIT 1').pluck().get(project);
  for (const url of [
    '/api/v1/projects',
    '/api/v1/projects?q=Proyecto&status=active',
    `/api/v1/projects/${project}`,
    `/api/v1/projects/${project}/summary`,
    `/api/v1/projects/${project}/gantt`,
    `/api/v1/projects/${project}/gantt?groupBy=sprint`,
    '/api/v1/gantt/portfolio',
    `/api/v1/projects/${project}/burnup`,
    `/api/v1/sprints/${sprint}/burndown`,
    `/api/v1/sprints/${sprint}/burndown?metric=hours`,
    `/api/v1/sprints/${sprint}/board`,
    `/api/v1/projects/${project}/tasks`,
    `/api/v1/projects/${project}/tasks?backlog=true&q=Tarea`,
    `/api/v1/tasks/${task}`,
    `/api/v1/tasks/${task}/history`,
    `/api/v1/tasks/${task}/dependencies`,
    `/api/v1/projects/${project}/milestones`,
    `/api/v1/projects/${project}/assignments`,
    `/api/v1/projects/${project}/sprints`,
    '/api/v1/clients',
    '/api/v1/clients?type=external&q=Externo',
    `/api/v1/clients/${db.prepare('SELECT id FROM clients LIMIT 1').pluck().get()}/summary`,
    '/api/v1/team-members',
    `/api/v1/team-members/${member}`,
    `/api/v1/team-members/${member}/skills`,
    `/api/v1/team-members/${member}/time-off`,
    '/api/v1/time-entries',
    '/api/v1/time-entries?status=submitted&from=2026-03-01&to=2026-05-13',
    `/api/v1/time-entries?memberId=${member}`,
    `/api/v1/time-entries?projectId=${project}&from=2026-04-01`,
    '/api/v1/time-entries/pending',
    `/api/v1/time-sheet?memberId=${member}`,
    '/api/v1/time-entries/export.csv?from=2026-05-01&to=2026-05-13',
    '/api/v1/dashboard/kpis',
    '/api/v1/dashboard/kpis?clientType=external&from=2026-02-01&to=2026-05-13',
    `/api/v1/dashboard/kpis?projectId=${project}`,
    '/api/v1/assignments/load',
    '/api/v1/assignments/matrix',
    '/api/v1/users',
    '/api/v1/settings/kpi-thresholds',
    '/projects',
    '/team',
    '/dashboard',
    `/projects/${project}`,
    `/projects/${project}/backlog`,
    `/tasks/${task}`,
    '/clients/internal',
    '/clients/external',
    '/time',
    `/time/approvals`,
  ]) {
    const res = await agent.get(url);
    assert.ok(res.status < 400, `${url} → ${res.status}`);
  }
});

test('ninguna consulta de la aplicación recorre por completo una tabla grande (SCAN sin índice)', () => {
  assert.ok(captured.size > 40, `se capturaron ${captured.size} consultas`);
  const offenders = [];
  for (const [sql, args] of captured) {
    let plan;
    try {
      plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args);
    } catch {
      continue; // consulta con parámetros nombrados no reproducibles aquí
    }
    for (const step of plan) {
      const match = /^SCAN (?:TABLE )?(\w+)(?: AS \w+)?(.*)$/.exec(step.detail);
      if (!match || /USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY/.test(match[2])) continue;
      // EXPLAIN muestra el alias (p. ej. `SCAN e`): se resuelve a su tabla con el texto de la consulta.
      const alias = new RegExp(`\\b(?:FROM|JOIN)\\s+(\\w+)(?:\\s+AS)?\\s+${match[1]}\\b`, 'i').exec(
        sql,
      );
      const table = alias ? alias[1] : match[1];
      if (BIG_TABLES.includes(table)) {
        offenders.push(
          `${step.detail} (${table})\n      ← ${sql.replace(/\s+/g, ' ').slice(0, 160)}`,
        );
      }
    }
  }
  console.log(`# consultas revisadas: ${captured.size}; recorridos completos: ${offenders.length}`);
  assert.deepEqual(offenders, [], `SCAN sin índice:\n${offenders.join('\n')}`);
});
