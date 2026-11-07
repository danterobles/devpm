// Generador de volumen para la prueba de rendimiento (RNF-01): 50 proyectos, 50 miembros y
// 100 000 registros de tiempo, más tareas, sprints, asignaciones e instantáneas. Determinista.
import bcrypt from 'bcrypt';
import { addDays } from '../../src/lib/dates.js';

/** Generador pseudoaleatorio determinista (mulberry32). */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadVolume(
  db,
  { today = '2026-05-13', projects = 50, members = 50, entries = 100_000, seed = 7 } = {},
) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const hash = bcrypt.hashSync('Secreta123!', 4);
  const POINTS = [1, 2, 3, 5, 8, 13];
  const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'];

  db.transaction(() => {
    const run = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid);
    for (const [role, email] of [
      ['admin', 'admin@perf.local'],
      ['viewer', 'viewer@perf.local'],
    ]) {
      run(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
        email,
        hash,
        role,
        role,
      );
    }
    const memberIds = Array.from({ length: members }, (_, i) =>
      run(
        `INSERT INTO team_members (first_name, last_name, email, position, seniority, weekly_capacity_minutes, hourly_cost_cents)
         VALUES (?, ?, ?, ?, 'mid', 2400, 40000)`,
        `Miembro${i}`,
        `Apellido${i}`,
        `m${i}@perf.local`,
        pick(['frontend', 'backend', 'fullstack', 'qa', 'devops']),
      ),
    );
    // El admin de la prueba también registra tiempo (hoja propia).
    db.prepare("UPDATE users SET team_member_id = ? WHERE email = 'admin@perf.local'").run(
      memberIds[0],
    );
    const clientIds = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0
        ? run(
            "INSERT INTO clients (type, name, department) VALUES ('internal', ?, 'TI')",
            `Interno ${i}`,
          )
        : run(
            "INSERT INTO clients (type, name, legal_name, hourly_rate_cents, currency) VALUES ('external', ?, ?, 85000, 'MXN')",
            `Externo ${i}`,
            `Externo ${i} SA`,
          ),
    );

    const projectIds = [];
    const sprintIds = [];
    for (let p = 0; p < projects; p += 1) {
      const start = addDays(today, -120 + (p % 40));
      const end = addDays(start, 240);
      const status = p % 10 === 0 ? 'planning' : p % 13 === 0 ? 'completed' : 'active';
      const id = run(
        `INSERT INTO projects (code, name, client_id, manager_id, status, start_date, end_date, budget_minutes, is_billable)
         VALUES (?, ?, ?, ?, ?, ?, ?, 120000, ?)`,
        `PRJ-2026-${String(p + 1).padStart(3, '0')}`,
        `Proyecto ${p + 1}`,
        pick(clientIds),
        pick(memberIds),
        status,
        start,
        end,
        p % 2,
      );
      projectIds.push(id);
      // 4 miembros asignados por proyecto
      for (let k = 0; k < 4; k += 1) {
        run(
          'INSERT INTO assignments (project_id, team_member_id, project_role, allocation_percent, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
          id,
          memberIds[(p * 4 + k) % memberIds.length],
          'Desarrollo',
          25 + (k % 3) * 25,
          start,
          end,
        );
      }
      // 3 sprints (2 cerrados, 1 activo) y 60 tareas por proyecto
      for (let s = 0; s < 3; s += 1) {
        const sStart = addDays(start, s * 14);
        const sid = run(
          `INSERT INTO sprints (project_id, name, start_date, end_date, status, committed_points, completed_points)
           VALUES (?, ?, ?, ?, ?, 40, ?)`,
          id,
          `Sprint ${s + 1}`,
          sStart,
          addDays(sStart, 13),
          s < 2 ? 'closed' : status === 'active' ? 'active' : 'planned',
          s < 2 ? 36 : null,
        );
        sprintIds.push(sid);
      }
      for (let t = 0; t < 60; t += 1) {
        const tStart = addDays(start, Math.floor(rand() * 60));
        run(
          `INSERT INTO tasks (project_id, sprint_id, title, status, story_points, estimated_minutes, assignee_id, start_date, due_date, started_at, completed_at, sort_order)
           VALUES (?, ?, ?, ?, ?, 480, ?, ?, ?, ?, ?, ?)`,
          id,
          sprintIds.at(-3 + (t % 3)),
          `Tarea ${t + 1}`,
          pick(STATUSES),
          pick(POINTS),
          pick(memberIds),
          tStart,
          addDays(tStart, 3 + Math.floor(rand() * 10)),
          `${tStart}T09:00:00.000Z`,
          `${addDays(tStart, 5)}T17:00:00.000Z`,
          t,
        );
      }
      run(
        'INSERT INTO milestones (project_id, name, due_date) VALUES (?, ?, ?)',
        id,
        'Entrega',
        addDays(start, 120),
      );
    }

    // Instantáneas diarias de los sprints activos
    for (const sid of sprintIds) {
      for (let d = 0; d < 14; d += 1) {
        run(
          `INSERT OR IGNORE INTO sprint_daily_snapshots (sprint_id, snapshot_date, total_points, completed_points, remaining_points, remaining_minutes)
           VALUES (?, ?, 40, ?, ?, 1200)`,
          sid,
          addDays(today, -d),
          40 - d,
          d,
        );
      }
    }

    // 100 000 registros de tiempo repartidos en ~300 días
    const insertEntry = db.prepare(
      `INSERT INTO time_entries (team_member_id, project_id, work_date, minutes, description, is_billable, status)
       VALUES (?, ?, ?, ?, 'Trabajo de desarrollo', ?, ?)`,
    );
    const ENTRY_STATUS = ['approved', 'approved', 'approved', 'submitted', 'draft'];
    for (let i = 0; i < entries; i += 1) {
      const projectIndex = Math.floor(rand() * projects);
      insertEntry.run(
        memberIds[(projectIndex * 4 + Math.floor(rand() * 4)) % memberIds.length],
        projectIds[projectIndex],
        addDays(today, -Math.floor(rand() * 300)),
        30 + Math.floor(rand() * 8) * 30,
        rand() < 0.6 ? 1 : 0,
        pick(ENTRY_STATUS),
      );
    }
  })();
  return { projectIds: db.prepare('SELECT id FROM projects').pluck().all() };
}
