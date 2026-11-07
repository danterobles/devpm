// Prueba de rendimiento RNF-01: con 50 proyectos, 50 miembros y 100 000 registros de tiempo, las
// páginas de listado y la API responden en < 300 ms (p95). No forma parte de `npm test`; se ejecuta
// con `npm run test:perf`.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { loadVolume } from './volume.js';

const LIMIT_MS = 300;
const SAMPLES = 40;
let agent;
let sample;

before(async () => {
  setClock(() => new Date('2026-05-13T18:00:00Z'));
  const db = createTestDb();
  const t0 = performance.now();
  sample = loadVolume(db);
  console.log(
    `# volumen cargado en ${Math.round(performance.now() - t0)} ms: ${db.prepare('SELECT count(*) FROM time_entries').pluck().get()} registros de tiempo`,
  );
  const app = buildTestApp({ db });
  agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ email: 'admin@perf.local', password: 'Secreta123!' });
  sample.sprintId = db
    .prepare("SELECT id FROM sprints WHERE status = 'active' LIMIT 1")
    .pluck()
    .get();
  sample.projectId = db
    .prepare("SELECT id FROM projects WHERE status = 'active' LIMIT 1")
    .pluck()
    .get();
  sample.memberId = db.prepare('SELECT id FROM team_members LIMIT 1').pluck().get();
});

const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

async function measure(label, url) {
  const times = [];
  for (let i = 0; i < SAMPLES + 3; i += 1) {
    const t0 = performance.now();
    const res = await agent.get(url);
    const elapsed = performance.now() - t0;
    assert.equal(res.status, 200, `${label}: ${url} → ${res.status}`);
    if (i >= 3) times.push(elapsed); // se descartan 3 de calentamiento
  }
  const value = p95(times);
  console.log(
    `# ${label.padEnd(34)} p95 ${value.toFixed(1).padStart(6)} ms  (máx ${Math.max(...times).toFixed(1)} ms)`,
  );
  assert.ok(value < LIMIT_MS, `${label}: p95 ${value.toFixed(1)} ms ≥ ${LIMIT_MS} ms`);
}

// [etiqueta, URL]; las URL se calculan al ejecutar porque dependen de los ids generados.
const CASES = [
  ['API proyectos', () => '/api/v1/projects'],
  ['API proyectos (búsqueda)', () => '/api/v1/projects?q=Proyecto%201&status=active'],
  ['API clientes', () => '/api/v1/clients'],
  ['API equipo', () => '/api/v1/team-members'],
  ['API registros de tiempo', () => '/api/v1/time-entries'],
  [
    'API registros (rango y proyecto)',
    () => `/api/v1/time-entries?from=2026-03-01&to=2026-04-30&projectId=${sample.projectId}`,
  ],
  ['API hoja semanal', () => `/api/v1/time-sheet?memberId=${sample.memberId}`],
  ['API tareas del proyecto', () => `/api/v1/projects/${sample.projectId}/tasks`],
  // RF-153: la búsqueda global (LIKE) también debe cumplir RNF-01 con el volumen; si no, se evalúa FTS5.
  ['API búsqueda global (proyecto)', () => '/api/v1/search?q=Proyecto'],
  ['API búsqueda global (tarea)', () => '/api/v1/search?q=tarea'],
  ['API búsqueda global (sin resultados)', () => '/api/v1/search?q=zzzz'],
  ['Página de búsqueda', () => '/search?q=Proyecto'],
  ['API tablero de KPIs', () => '/api/v1/dashboard/kpis'],
  [
    'API KPIs con filtros',
    () => '/api/v1/dashboard/kpis?clientType=external&from=2026-02-01&to=2026-05-13',
  ],
  ['API Gantt del proyecto', () => `/api/v1/projects/${sample.projectId}/gantt`],
  ['API Gantt de portafolio', () => '/api/v1/gantt/portfolio'],
  ['API Burndown', () => `/api/v1/sprints/${sample.sprintId}/burndown`],
  ['API Burnup', () => `/api/v1/projects/${sample.projectId}/burnup`],
  ['API carga del equipo', () => '/api/v1/assignments/load'],
  ['API matriz de asignaciones', () => '/api/v1/assignments/matrix'],
  ['Página proyectos', () => '/projects'],
  ['Página equipo', () => '/team'],
  ['Página tablero', () => '/dashboard'],
  ['Página hoja de tiempos', () => `/time?memberId=${sample.memberId}`],
  ['Página backlog', () => `/projects/${sample.projectId}/backlog`],
];

for (const [label, url] of CASES) {
  test(`RNF-01 · ${label}`, () => measure(label, url()));
}
