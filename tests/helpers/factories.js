// Factories mínimas: insertan filas válidas y devuelven su id. `o` sobreescribe columnas.
let seq = 0;
const n = () => ++seq;

function insert(db, table, row) {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  return Number(db.prepare(sql).run(...Object.values(row)).lastInsertRowid);
}

export const teamMember = (db, o = {}) =>
  insert(db, 'team_members', {
    first_name: 'Ana',
    last_name: 'Pérez',
    email: `dev${n()}@test.local`,
    position: 'backend',
    seniority: 'mid',
    ...o,
  });

export const user = (db, o = {}) =>
  insert(db, 'users', {
    email: `user${n()}@test.local`,
    password_hash: 'hash',
    full_name: 'Usuario Prueba',
    role: 'pm',
    ...o,
  });

export const internalClient = (db, o = {}) =>
  insert(db, 'clients', { type: 'internal', name: `TI ${n()}`, department: 'TI', ...o });

export const externalClient = (db, o = {}) =>
  insert(db, 'clients', {
    type: 'external',
    name: `Acme ${n()}`,
    legal_name: 'Acme SA de CV',
    hourly_rate_cents: 85000,
    ...o,
  });

export const project = (db, o = {}) =>
  insert(db, 'projects', {
    code: `PRJ-${n()}`,
    name: 'Proyecto',
    client_id: o.client_id ?? internalClient(db),
    start_date: '2026-01-01',
    end_date: '2026-06-30',
    is_billable: 0,
    ...o,
  });

export const sprint = (db, o = {}) =>
  insert(db, 'sprints', {
    project_id: o.project_id ?? project(db),
    name: `Sprint ${n()}`,
    start_date: '2026-01-05',
    end_date: '2026-01-16',
    ...o,
  });

export const task = (db, o = {}) =>
  insert(db, 'tasks', { project_id: o.project_id ?? project(db), title: `Tarea ${n()}`, ...o });

export const assignment = (db, o = {}) =>
  insert(db, 'assignments', {
    project_id: o.project_id ?? project(db),
    team_member_id: o.team_member_id ?? teamMember(db),
    project_role: 'Desarrollo',
    allocation_percent: 50,
    start_date: '2026-01-01',
    end_date: '2026-06-30',
    ...o,
  });

export const timeEntry = (db, o = {}) =>
  insert(db, 'time_entries', {
    team_member_id: o.team_member_id ?? teamMember(db),
    project_id: o.project_id ?? project(db),
    work_date: '2026-01-10',
    minutes: 60,
    description: 'Trabajo',
    is_billable: 0,
    ...o,
  });
