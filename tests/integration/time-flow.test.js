import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestDb } from '../helpers/testDb.js';
import { setClock } from '../../src/lib/dates.js';
import { user, teamMember, externalClient, assignment } from '../helpers/factories.js';

// Criterio de cierre de la Etapa 7 (PRD §8.3, sin KPIs): un developer registra horas en su hoja
// semanal y el pm (líder del proyecto) las aprueba.
const PASSWORD = 'Secreta123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
afterEach(() => setClock(() => new Date()));

test('flujo completo: registrar en la hoja → enviar la semana → rechazar/corregir → aprobar → exportar', async () => {
  setClock(() => new Date('2026-05-15T18:00:00Z')); // viernes
  const db = createTestDb();
  const dev = teamMember(db, { first_name: 'Ana', last_name: 'Ruiz' });
  const lead = teamMember(db, { first_name: 'Lía', last_name: 'Vega' });
  user(db, {
    email: 'dev@test.local',
    password_hash: hash,
    role: 'developer',
    team_member_id: dev,
  });
  user(db, { email: 'lead@test.local', password_hash: hash, role: 'pm', team_member_id: lead });
  user(db, {
    email: 'other@test.local',
    password_hash: hash,
    role: 'pm',
    team_member_id: teamMember(db),
  });
  const app = buildTestApp({ db });
  const login = async (who) => {
    const a = request.agent(app);
    await a
      .post('/login')
      .type('form')
      .send({ email: `${who}@test.local`, password: PASSWORD });
    return a;
  };
  const developer = await login('dev');
  const pm = await login('lead');

  const project = (
    await pm.post('/api/v1/projects').send({
      name: 'Portal',
      clientId: externalClient(db),
      managerId: lead,
      startDate: '2026-01-05',
      endDate: '2026-12-18',
    })
  ).body.data;
  assert.equal(project.isBillable, true); // cliente externo ⇒ facturable por defecto
  assignment(db, {
    project_id: project.id,
    team_member_id: dev,
    start_date: '2026-03-01',
    end_date: '2026-06-30',
  });

  // 1. El developer registra horas en su hoja (formulario con horas decimales).
  for (const [workDate, hours, description] of [
    ['2026-05-11', '4', 'Diseño'],
    ['2026-05-12', '6.5', 'Implementación'],
    ['2026-05-13', '8', 'Pruebas'],
  ]) {
    const res = await developer
      .post('/time/entries')
      .type('form')
      .send({ projectId: String(project.id), workDate, hours, description });
    assert.equal(res.status, 302);
  }
  const sheet = (await developer.get('/api/v1/time-sheet?week=2026-05-13')).body.data;
  assert.equal(sheet.total, 18.5 * 60);
  assert.deepEqual(sheet.statusSummary, { draft: 3, submitted: 0, approved: 0, rejected: 0 });
  // El pm no ve nada pendiente todavía.
  assert.equal((await pm.get('/api/v1/time-entries/pending')).body.data.length, 0);

  // 2. El developer envía la semana.
  const sent = await developer.post('/time/submit-week').type('form').send({ week: '2026-05-13' });
  assert.equal(sent.status, 302);
  const pending = (await pm.get('/api/v1/time-entries/pending')).body.data;
  assert.equal(pending.length, 3);
  // Un pm ajeno no puede revisarlas.
  const other = await login('other');
  assert.equal(
    (await other.post(`/api/v1/time-entries/${pending[0].id}/approve`).send({})).status,
    403,
  );

  // 3. El líder rechaza una (con motivo) y aprueba las otras.
  const [first, second, third] = pending;
  assert.equal(
    (
      await pm
        .post(`/time/approvals/${first.id}/reject`)
        .type('form')
        .send({ reason: 'Detalla qué se diseñó' })
    ).status,
    302,
  );
  assert.equal(
    (await pm.post(`/time/approvals/${second.id}/approve`).type('form').send({})).status,
    302,
  );
  assert.equal(
    (await pm.post(`/time/approvals/${third.id}/approve`).type('form').send({})).status,
    302,
  );

  // 4. El developer ve el motivo, corrige y reenvía; el líder aprueba.
  const rejected = (await developer.get(`/api/v1/time-entries/${first.id}`)).body.data;
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.rejectionReason, 'Detalla qué se diseñó');
  const fixed = await developer
    .post(`/time/entries/${first.id}`)
    .type('form')
    .send({
      projectId: String(project.id),
      taskId: '',
      workDate: '2026-05-11',
      hours: '4',
      description: 'Diseño de pantallas y flujos',
    });
  assert.equal(fixed.status, 302);
  assert.equal(
    (await developer.post(`/time/entries/${first.id}/submit`).type('form').send({})).status,
    302,
  );
  assert.equal(
    (await pm.post(`/time/approvals/${first.id}/approve`).type('form').send({})).status,
    302,
  );

  // 5. Todo aprobado: la hoja lo refleja y los registros quedan de solo lectura.
  const final = (await developer.get('/api/v1/time-sheet?week=2026-05-13')).body.data;
  assert.deepEqual(final.statusSummary, { draft: 0, submitted: 0, approved: 3, rejected: 0 });
  assert.equal(
    (await developer.patch(`/api/v1/time-entries/${first.id}`).send({ minutes: 30 })).status,
    422,
  );
  assert.equal((await developer.delete(`/api/v1/time-entries/${second.id}`)).status, 422);

  // 6. El líder exporta las horas aprobadas facturables del proyecto.
  const csv = await pm
    .get(`/api/v1/time-entries/export.csv?status=approved&projectId=${project.id}`)
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (data += c));
      r.on('end', () => cb(null, data));
    });
  const rows = csv.body.trimEnd().split('\r\n');
  assert.equal(rows.length, 4);
  assert.ok(rows.slice(1).every((r) => r.includes(',Sí,approved,')));
});
