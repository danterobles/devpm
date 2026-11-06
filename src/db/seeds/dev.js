// Datos de ejemplo para desarrollo (docs/DATA.md §7). Determinista y relativo a la fecha actual.
import bcrypt from 'bcrypt';
import { addDays, isWeekend, today as todayFn } from '../../lib/dates.js';

export const SEED_PASSWORD = 'Cambiar123!';

function insert(db, table, row) {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  return Number(db.prepare(sql).run(...Object.values(row)).lastInsertRowid);
}

const minutes = (h) => h * 60;

const MEMBERS = [
  ['Laura', 'Méndez', 'pm', 'lead', 130000],
  ['Carlos', 'Ruiz', 'backend', 'lead', 120000],
  ['Marta', 'Soto', 'frontend', 'senior', 105000],
  ['Diego', 'Navarro', 'fullstack', 'mid', 80000],
  ['Sofía', 'Vega', 'qa', 'mid', 70000],
  ['Pablo', 'Ortega', 'devops', 'senior', 110000],
  ['Elena', 'Castro', 'designer', 'mid', 75000],
  ['Javier', 'Luna', 'backend', 'junior', 50000],
  ['Lucía', 'Pineda', 'frontend', 'mid', 78000],
  ['Andrés', 'Salas', 'fullstack', 'senior', 115000],
];

const SKILLS = [
  ['JavaScript', 'language'],
  ['TypeScript', 'language'],
  ['Node.js', 'framework'],
  ['React', 'framework'],
  ['SQL', 'language'],
  ['Docker', 'tool'],
  ['Figma', 'tool'],
  ['Comunicación', 'soft'],
];

// [índice de miembro, [índices de skill, nivel]...]
const MEMBER_SKILLS = [
  [0, [7, 5]],
  [1, [0, 5], [2, 5], [4, 4]],
  [2, [0, 5], [1, 4], [3, 5]],
  [3, [0, 4], [3, 3], [2, 3]],
  [4, [0, 3], [7, 4]],
  [5, [5, 5], [2, 3]],
  [6, [6, 5], [7, 4]],
  [7, [0, 2], [2, 2], [4, 2]],
  [8, [3, 4], [1, 3]],
  [9, [0, 5], [1, 4], [2, 4], [3, 4]],
];

const TASK_TITLES = [
  'Diseñar modelo de datos',
  'Implementar autenticación',
  'Crear pantalla de listado',
  'Formulario de alta y edición',
  'Integrar API de terceros',
  'Pruebas de integración',
  'Configurar pipeline CI',
  'Optimizar consultas lentas',
  'Pantalla de reportes',
  'Corregir error de paginación',
  'Documentar endpoints',
  'Manejo de errores global',
  'Exportar a CSV',
  'Notificaciones en pantalla',
  'Revisión de accesibilidad',
];
const POINTS = [3, 5, 2, 3, 8, 3, 2, 5, 5, 1, 2, 3, 2, 3, 2];

export async function seed(db, { timezone = 'America/Mexico_City' } = {}) {
  const T = todayFn(timezone);
  const d = (offset) => addDays(T, offset);
  const hash = await bcrypt.hash(SEED_PASSWORD, 12);

  return db.transaction(() => {
    // --- Equipo, skills y ausencias ---
    const memberIds = MEMBERS.map(([first, last, position, seniority, cost], i) =>
      insert(db, 'team_members', {
        first_name: first,
        last_name: last,
        email: `${first}.${last}@devpm.local`
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, ''),
        position,
        seniority,
        hourly_cost_cents: cost,
        hire_date: d(-400 - i * 30),
      }),
    );
    const skillIds = SKILLS.map(([name, category]) => insert(db, 'skills', { name, category }));
    for (const [mi, ...skills] of MEMBER_SKILLS) {
      for (const [si, level] of skills) {
        insert(db, 'team_member_skills', {
          team_member_id: memberIds[mi],
          skill_id: skillIds[si],
          level,
        });
      }
    }
    const timeOff = [
      { m: 4, type: 'vacation', from: d(3), to: d(7) },
      { m: 8, type: 'sick', from: d(-3), to: d(-2) },
    ];
    for (const t of timeOff) {
      insert(db, 'time_off', {
        team_member_id: memberIds[t.m],
        type: t.type,
        start_date: t.from,
        end_date: t.to,
      });
    }

    // --- Usuarios (uno por rol) ---
    const mkUser = (email, full_name, role, member) =>
      insert(db, 'users', {
        email,
        password_hash: hash,
        full_name,
        role,
        team_member_id: member === null ? null : memberIds[member],
      });
    mkUser('admin@devpm.local', 'Administrador', 'admin', null);
    const pmUser = mkUser('pm@devpm.local', 'Laura Méndez', 'pm', 0);
    mkUser('dev@devpm.local', 'Carlos Ruiz', 'developer', 1);
    mkUser('viewer@devpm.local', 'Dirección General', 'viewer', null);

    // --- Clientes ---
    const internal = ['TI', 'Finanzas', 'Recursos Humanos'].map((dept, i) =>
      insert(db, 'clients', {
        type: 'internal',
        name: dept,
        department: dept,
        cost_center: `CC-${100 + i}`,
        contact_name: `Responsable de ${dept}`,
        contact_email: `${dept.toLowerCase().replace(/\s/g, '')}@empresa.local`,
      }),
    );
    const external = [
      ['Grupo Aurora', 'Grupo Aurora SA de CV', 'GAU010101AA1', 95000],
      ['Logística Norte', 'Logística del Norte SAPI', 'LNO020202BB2', 85000],
      ['Salud Plus', 'Salud Plus SC', 'SPL030303CC3', 110000],
    ].map(([name, legal_name, tax_id, rate]) =>
      insert(db, 'clients', {
        type: 'external',
        name,
        legal_name,
        tax_id,
        hourly_rate_cents: rate,
        contact_name: `Contacto ${name}`,
        contact_email: `contacto@${name.toLowerCase().replace(/\s/g, '')}.example`,
      }),
    );

    // --- Proyectos ---
    const P = [
      {
        code: 'PRJ-001',
        name: 'Portal de clientes web',
        c: external[0],
        status: 'active',
        meth: 'scrum',
        prio: 'high',
        s: -70,
        e: 50,
        h: 1200,
      },
      {
        code: 'PRJ-002',
        name: 'App móvil de ventas',
        c: external[1],
        status: 'active',
        meth: 'scrum',
        prio: 'critical',
        s: -40,
        e: 80,
        h: 900,
      },
      {
        code: 'PRJ-003',
        name: 'Migración ERP financiero',
        c: internal[1],
        status: 'active',
        meth: 'kanban',
        prio: 'high',
        s: -120,
        e: -10,
        h: 800,
      },
      {
        code: 'PRJ-004',
        name: 'Portal de autoservicio RH',
        c: internal[2],
        status: 'active',
        meth: 'scrum',
        prio: 'medium',
        s: -28,
        e: 60,
        h: 500,
      },
      {
        code: 'PRJ-005',
        name: 'API de pagos',
        c: external[2],
        status: 'planning',
        meth: 'scrum',
        prio: 'medium',
        s: 14,
        e: 120,
        h: 700,
      },
      {
        code: 'PRJ-006',
        name: 'Sitio corporativo',
        c: external[0],
        status: 'completed',
        meth: 'waterfall',
        prio: 'low',
        s: -150,
        e: -30,
        h: 300,
      },
    ];
    const projects = P.map((p) => ({
      ...p,
      is_billable: external.includes(p.c) ? 1 : 0,
      id: insert(db, 'projects', {
        code: p.code,
        name: p.name,
        description: `Proyecto de ejemplo: ${p.name}.`,
        client_id: p.c,
        manager_id: memberIds[0],
        status: p.status,
        priority: p.prio,
        methodology: p.meth,
        start_date: d(p.s),
        end_date: d(p.e),
        actual_start_date: p.status === 'planning' ? null : d(p.s),
        actual_end_date: p.status === 'completed' ? d(p.e) : null,
        budget_minutes: minutes(p.h),
        budget_cents: external.includes(p.c) ? p.h * 95000 : null,
        is_billable: external.includes(p.c) ? 1 : 0,
      }),
    }));
    const byCode = Object.fromEntries(projects.map((p) => [p.code, p]));

    // --- Hitos (PRJ-003 tiene uno vencido) ---
    const milestones = [
      ['PRJ-001', 'Alfa interna', -30, 'completed'],
      ['PRJ-001', 'Lanzamiento beta', 20, 'pending'],
      ['PRJ-002', 'Prototipo navegable', -10, 'completed'],
      ['PRJ-002', 'Piloto con clientes', 45, 'pending'],
      ['PRJ-003', 'Corte contable', -40, 'completed'],
      ['PRJ-003', 'Puesta en producción', -15, 'pending'],
      ['PRJ-004', 'MVP autoservicio', 30, 'pending'],
      ['PRJ-005', 'Diseño aprobado', 30, 'pending'],
    ];
    const milestoneIds = {};
    for (const [code, name, off, status] of milestones) {
      milestoneIds[`${code}:${name}`] = insert(db, 'milestones', {
        project_id: byCode[code].id,
        name,
        due_date: d(off),
        status,
        completed_at: status === 'completed' ? `${d(off)}T18:00:00.000Z` : null,
      });
    }

    // --- Asignaciones (Diego, índice 3, queda al 120 %) ---
    const A = {
      'PRJ-001': [
        [1, 'Backend líder', 50],
        [2, 'Frontend', 60],
        [3, 'Fullstack', 60],
        [4, 'QA', 40],
        [0, 'Líder de proyecto', 20],
      ],
      'PRJ-002': [
        [3, 'Fullstack', 60],
        [8, 'Frontend móvil', 80],
        [9, 'Arquitecto', 70],
        [6, 'Diseño UX', 30],
        [4, 'QA', 30],
        [0, 'Líder de proyecto', 20],
      ],
      'PRJ-003': [
        [9, 'Arquitecto', 30],
        [7, 'Backend', 100],
        [5, 'DevOps', 30],
        [0, 'Líder de proyecto', 20],
      ],
      'PRJ-004': [
        [1, 'Backend', 40],
        [8, 'Frontend', 20],
        [5, 'DevOps', 30],
        [0, 'Líder de proyecto', 20],
      ],
      'PRJ-005': [
        [7, 'Backend', 50],
        [2, 'Frontend', 40],
      ],
      'PRJ-006': [
        [2, 'Frontend', 50],
        [8, 'Frontend', 50],
      ],
    };
    const assignments = [];
    for (const [code, list] of Object.entries(A)) {
      const p = byCode[code];
      for (const [mi, project_role, allocation_percent] of list) {
        const rec = {
          project_id: p.id,
          team_member_id: memberIds[mi],
          project_role,
          allocation_percent,
          start_date: d(p.s),
          end_date: d(p.e),
        };
        assignments.push({ ...rec, id: insert(db, 'assignments', rec), code });
      }
    }

    // --- Sprints y tareas ---
    const sprintInfo = {}; // code -> { id, start, end, taskIds[] }
    const taskCount = { tasks: 0 };
    for (const code of ['PRJ-001', 'PRJ-002', 'PRJ-004']) {
      const p = byCode[code];
      const members = A[code].filter(([mi]) => mi !== 0).map(([mi]) => memberIds[mi]);
      const sStart = d(-9);
      const sEnd = d(4);

      // Sprint anterior (cerrado)
      const closedId = insert(db, 'sprints', {
        project_id: p.id,
        name: 'Sprint 1',
        goal: 'Base técnica',
        start_date: d(-23),
        end_date: d(-10),
        status: 'closed',
        committed_points: 30,
        completed_points: code === 'PRJ-001' ? 27 : 24,
      });
      for (let i = 0; i < 4; i++) {
        insert(db, 'tasks', {
          project_id: p.id,
          sprint_id: closedId,
          title: `Cierre sprint 1 · ${TASK_TITLES[i]}`,
          status: 'done',
          story_points: POINTS[i],
          assignee_id: members[i % members.length],
          start_date: d(-23),
          due_date: d(-12),
          started_at: `${d(-22)}T15:00:00.000Z`,
          completed_at: `${d(-12)}T20:00:00.000Z`,
        });
        taskCount.tasks++;
      }

      // Sprint activo con 15 tareas
      const sprintId = insert(db, 'sprints', {
        project_id: p.id,
        name: 'Sprint 2',
        goal: 'Entregar funcionalidad principal',
        start_date: sStart,
        end_date: sEnd,
        status: 'active',
        committed_points: POINTS.reduce((a, b) => a + b, 0),
      });
      const taskIds = [];
      for (let i = 0; i < 15; i++) {
        let status = 'todo';
        if (i < 6) status = 'done';
        else if (i < 9) status = 'in_progress';
        else if (i === 9) status = 'in_review';
        else if (i === 10 && code === 'PRJ-001') status = 'blocked';

        const startOff = -9 + Math.floor((i * 10) / 15);
        let dueOff = Math.min(startOff + 2 + (i % 3), 4);
        if (code === 'PRJ-002' && i === 6) dueOff = -2; // tarea vencida
        const doneOff = Math.min(dueOff, -1);
        const row = {
          project_id: p.id,
          sprint_id: sprintId,
          milestone_id:
            milestoneIds[
              `${code}:${code === 'PRJ-001' ? 'Lanzamiento beta' : code === 'PRJ-002' ? 'Piloto con clientes' : 'MVP autoservicio'}`
            ],
          title: TASK_TITLES[i],
          type: i === 9 ? 'bug' : 'feature',
          status,
          priority: i % 5 === 0 ? 'high' : 'medium',
          story_points: POINTS[i],
          estimated_minutes: POINTS[i] * 120,
          assignee_id: members[i % members.length],
          start_date: d(startOff),
          due_date: d(Math.max(dueOff, startOff)),
          started_at: status === 'todo' ? null : `${d(Math.min(startOff, -1))}T15:00:00.000Z`,
          completed_at: status === 'done' ? `${d(Math.max(doneOff, -8))}T20:00:00.000Z` : null,
          sort_order: i,
        };
        const id = insert(db, 'tasks', row);
        taskIds.push({ id, ...row });
        taskCount.tasks++;

        insert(db, 'task_status_history', {
          task_id: id,
          from_status: null,
          to_status: 'todo',
          changed_by: pmUser,
          changed_at: `${sStart}T14:00:00.000Z`,
        });
        if (row.started_at) {
          insert(db, 'task_status_history', {
            task_id: id,
            from_status: 'todo',
            to_status: 'in_progress',
            changed_by: pmUser,
            changed_at: row.started_at,
          });
        }
        if (row.completed_at) {
          insert(db, 'task_status_history', {
            task_id: id,
            from_status: 'in_progress',
            to_status: 'done',
            changed_by: pmUser,
            changed_at: row.completed_at,
          });
        }
      }
      // Dependencias fin-a-inicio hacia adelante (sin ciclos)
      for (const i of [0, 3, 6, 9]) {
        insert(db, 'task_dependencies', {
          task_id: taskIds[i + 1].id,
          depends_on_task_id: taskIds[i].id,
        });
      }
      // Backlog del proyecto
      for (let i = 0; i < 5; i++) {
        insert(db, 'tasks', {
          project_id: p.id,
          title: `Backlog · ${TASK_TITLES[(i + 5) % 15]}`,
          status: 'backlog',
          story_points: [3, 5, 8, 2, 13][i],
          sort_order: 100 + i,
        });
        taskCount.tasks++;
      }

      // Snapshots diarios del burndown, coherentes con completed_at de las tareas
      const total = taskIds.reduce((a, t) => a + t.story_points, 0);
      for (let off = -9; off <= 0; off++) {
        const date = d(off);
        const completed = taskIds
          .filter((t) => t.completed_at && t.completed_at.slice(0, 10) <= date)
          .reduce((a, t) => a + t.story_points, 0);
        insert(db, 'sprint_daily_snapshots', {
          sprint_id: sprintId,
          snapshot_date: date,
          total_points: total,
          completed_points: completed,
          remaining_points: total - completed,
          remaining_minutes: (total - completed) * 120,
        });
      }
      sprintInfo[code] = { id: sprintId, taskIds };
    }

    // Tareas con fechas para el Gantt del proyecto Kanban (PRJ-003) y el completado
    const kanbanTasks = [
      ['Extracción de datos', 'done', -110, -80],
      ['Conciliación de saldos', 'done', -80, -45],
      ['Pruebas de carga', 'in_progress', -45, -15],
      ['Capacitación de usuarios', 'todo', -20, -5],
    ];
    for (const [title, status, s, e] of kanbanTasks) {
      insert(db, 'tasks', {
        project_id: byCode['PRJ-003'].id,
        milestone_id: milestoneIds['PRJ-003:Puesta en producción'],
        title,
        status,
        story_points: 8,
        estimated_minutes: 960,
        assignee_id: memberIds[7],
        start_date: d(s),
        due_date: d(e),
        started_at: status === 'todo' ? null : `${d(s)}T15:00:00.000Z`,
        completed_at: status === 'done' ? `${d(e)}T20:00:00.000Z` : null,
      });
      taskCount.tasks++;
    }

    // --- Registro de tiempo: últimas 6 semanas ---
    const offByMember = new Map();
    for (const t of timeOff) {
      const set = offByMember.get(memberIds[t.m]) ?? new Set();
      for (let o = -60; o <= 60; o++) if (d(o) >= t.from && d(o) <= t.to) set.add(d(o));
      offByMember.set(memberIds[t.m], set);
    }
    let timeCount = 0;
    let rejectedDone = false;
    for (let off = -42; off <= -1; off++) {
      const date = d(off);
      if (isWeekend(date)) continue;
      for (const a of assignments) {
        if (date < a.start_date || date > a.end_date) continue;
        if (offByMember.get(a.team_member_id)?.has(date)) continue;
        const mins = Math.max(30, Math.round((480 * a.allocation_percent) / 100 / 15) * 15);
        const proj = projects.find((p) => p.id === a.project_id);
        let status = 'approved';
        if (off >= -2) status = 'draft';
        else if (off >= -7) status = 'submitted';
        else if (off >= -14 && (a.id + off) % 5 === 0) status = 'submitted';
        const rejected = !rejectedDone && off === -9 && a.code === 'PRJ-001';
        if (rejected) rejectedDone = true;
        insert(db, 'time_entries', {
          team_member_id: a.team_member_id,
          project_id: a.project_id,
          work_date: date,
          minutes: mins,
          description: `Trabajo en ${proj.name}`,
          is_billable: proj.is_billable,
          status: rejected ? 'rejected' : status,
          approved_by: !rejected && status === 'approved' ? pmUser : null,
          approved_at:
            !rejected && status === 'approved' ? `${addDays(date, 1)}T16:00:00.000Z` : null,
          rejection_reason: rejected ? 'Falta detallar la tarea trabajada' : null,
        });
        timeCount++;
      }
    }

    insert(db, 'audit_log', {
      user_id: pmUser,
      entity: 'projects',
      entity_id: byCode['PRJ-001'].id,
      action: 'create',
      changes: JSON.stringify({ code: [null, 'PRJ-001'] }),
    });

    return {
      users: 4,
      clients: internal.length + external.length,
      teamMembers: memberIds.length,
      projects: projects.length,
      assignments: assignments.length,
      tasks: taskCount.tasks,
      timeEntries: timeCount,
    };
  })();
}
