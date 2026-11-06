const marks = (list) => list.map(() => '?').join(', ');

/** Consultas de agregación para los KPIs (PRD §6). Solo lectura. */
export function createKpiRepository(db) {
  const all = (sql, params = []) => db.prepare(sql).all(...params);

  return {
    /** Proyectos que cumplen los filtros del tablero (cualquier estado). */
    projects({ clientType, clientId, projectId, managerId }) {
      const where = [];
      const params = [];
      if (clientType) {
        where.push('c.type = ?');
        params.push(clientType);
      }
      if (clientId) {
        where.push('p.client_id = ?');
        params.push(clientId);
      }
      if (projectId) {
        where.push('p.id = ?');
        params.push(projectId);
      }
      if (managerId) {
        where.push('p.manager_id = ?');
        params.push(managerId);
      }
      return all(
        `SELECT p.id, p.code, p.name, p.status, p.start_date, p.end_date, p.budget_minutes,
                p.manager_id, c.type AS client_type
           FROM projects p JOIN clients c ON c.id = p.client_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY p.code`,
        params,
      );
    },

    /** Puntos totales y terminados por proyecto (incluye subtareas). */
    points(ids) {
      if (ids.length === 0) return [];
      return all(
        `SELECT project_id, COALESCE(SUM(story_points), 0) AS total,
                COALESCE(SUM(CASE WHEN status = 'done' THEN story_points END), 0) AS done
           FROM tasks WHERE project_id IN (${marks(ids)}) GROUP BY project_id`,
        ids,
      );
    },

    /** Minutos registrados (enviados y aprobados) acumulados por proyecto. */
    spentMinutes(ids) {
      if (ids.length === 0) return [];
      return all(
        `SELECT project_id, COALESCE(SUM(minutes), 0) AS minutes FROM time_entries
          WHERE status IN ('submitted','approved') AND project_id IN (${marks(ids)})
          GROUP BY project_id`,
        ids,
      );
    },

    /** Minutos del rango por bandera facturable y tipo de cliente (enviados y aprobados). */
    minutesInRange(ids, from, to) {
      if (ids.length === 0) return [];
      return all(
        `SELECT te.is_billable AS billable, c.type AS client_type, COALESCE(SUM(te.minutes), 0) AS minutes
           FROM time_entries te
           JOIN projects p ON p.id = te.project_id JOIN clients c ON c.id = p.client_id
          WHERE te.status IN ('submitted','approved') AND te.work_date BETWEEN ? AND ?
            AND te.project_id IN (${marks(ids)})
          GROUP BY te.is_billable, c.type`,
        [from, to, ...ids],
      );
    },

    /** K14: Σ minutos × tarifa de las horas facturables aprobadas de clientes externos, por moneda. */
    revenueRaw(ids, from, to) {
      if (ids.length === 0) return [];
      return all(
        `SELECT c.currency, SUM(te.minutes * c.hourly_rate_cents) AS minute_cents
           FROM time_entries te
           JOIN projects p ON p.id = te.project_id JOIN clients c ON c.id = p.client_id
          WHERE te.status = 'approved' AND te.is_billable = 1 AND c.type = 'external'
            AND te.work_date BETWEEN ? AND ? AND te.project_id IN (${marks(ids)})
          GROUP BY c.currency ORDER BY c.currency`,
        [from, to, ...ids],
      );
    },

    /** Últimos sprints cerrados (por fecha de fin) de los proyectos. */
    closedSprints(ids, limit = 3) {
      if (ids.length === 0) return [];
      return all(
        `SELECT id, name, end_date, committed_points, completed_points FROM sprints
          WHERE status = 'closed' AND project_id IN (${marks(ids)})
          ORDER BY end_date DESC, id DESC LIMIT ?`,
        [...ids, limit],
      );
    },

    openTasksCount(ids, { status, overdueBefore }) {
      if (ids.length === 0) return 0;
      const extra = [];
      const params = [...ids];
      if (status) {
        extra.push('AND status = ?');
        params.push(status);
      } else {
        extra.push("AND status != 'done'");
      }
      if (overdueBefore) {
        extra.push('AND due_date IS NOT NULL AND due_date < ?');
        params.push(overdueBefore);
      }
      return db
        .prepare(
          `SELECT count(*) FROM tasks WHERE project_id IN (${marks(ids)}) ${extra.join(' ')}`,
        )
        .pluck()
        .get(...params);
    },

    /** K12: ciclo (días) de tareas terminadas dentro del rango que tienen inicio y fin. */
    cycle(ids, from, to) {
      if (ids.length === 0) return { days: null, tasks: 0 };
      const row = db
        .prepare(
          `SELECT AVG(julianday(completed_at) - julianday(started_at)) AS days, count(*) AS tasks
             FROM tasks
            WHERE status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL
              AND substr(completed_at, 1, 10) BETWEEN ? AND ? AND project_id IN (${marks(ids)})`,
        )
        .get(from, to, ...ids);
      return { days: row.days, tasks: row.tasks };
    },

    /** Hitos no cumplidos con fecha vencida, por proyecto. */
    overdueMilestones(ids, today) {
      if (ids.length === 0) return [];
      return all(
        `SELECT project_id, count(*) AS total FROM milestones
          WHERE status != 'completed' AND due_date < ? AND project_id IN (${marks(ids)})
          GROUP BY project_id`,
        [today, ...ids],
      );
    },

    activeMembers: () =>
      all('SELECT id, weekly_capacity_minutes AS capacity FROM team_members WHERE is_active = 1'),

    /** Miembros con alguna asignación, en proyectos dados, que toca el rango. */
    assignedMemberIds(ids, from, to, { onlyOpenProjects = false } = {}) {
      if (ids.length === 0) return [];
      return all(
        `SELECT DISTINCT a.team_member_id AS id FROM assignments a JOIN projects p ON p.id = a.project_id
          WHERE a.project_id IN (${marks(ids)}) AND a.start_date <= ? AND a.end_date >= ?
            ${onlyOpenProjects ? "AND p.status IN ('planning','active')" : ''}`,
        [...ids, to, from],
      ).map((r) => r.id);
    },

    timeOff: (from, to) =>
      all(
        'SELECT team_member_id AS member, start_date, end_date FROM time_off WHERE start_date <= ? AND end_date >= ?',
        [to, from],
      ),

    /** Asignaciones de proyectos planeados o activos de los miembros que tocan el rango. */
    allocations(memberIds, from, to) {
      if (memberIds.length === 0) return [];
      return all(
        `SELECT a.team_member_id AS member, a.allocation_percent AS percent, a.start_date, a.end_date
           FROM assignments a JOIN projects p ON p.id = a.project_id
          WHERE p.status IN ('planning','active') AND a.team_member_id IN (${marks(memberIds)})
            AND a.start_date <= ? AND a.end_date >= ?`,
        [...memberIds, to, from],
      );
    },
  };
}
