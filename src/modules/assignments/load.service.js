import { AppError } from '../../lib/AppError.js';
import { addDays, isWeekend, today as todayIn, weekday } from '../../lib/dates.js';
import { DEFAULT_WEEKS, MAX_WEEKS } from './load.schemas.js';

const mondayOf = (date) => addDays(date, -((weekday(date) + 6) % 7));
const sundayOf = (date) => addDays(mondayOf(date), 6);

/** Vistas de lectura sobre asignaciones: carga semanal (RF-23) y matriz (RF-43). */
export function createLoadService({ db, timezone = 'America/Mexico_City' }) {
  /** Rango en semanas completas lunes–domingo; por defecto 8 semanas desde la actual. */
  function resolveRange({ from, to }) {
    const start = mondayOf(from ?? todayIn(timezone));
    const end = to ? sundayOf(to) : addDays(start, DEFAULT_WEEKS * 7 - 1);
    if (end < start) {
      throw AppError.validation('Datos inválidos', [
        { field: 'to', message: 'La fecha final no puede ser anterior a la inicial' },
      ]);
    }
    const weeks = [];
    for (let s = start; s <= end; s = addDays(s, 7)) weeks.push({ start: s, end: addDays(s, 6) });
    if (weeks.length > MAX_WEEKS) {
      throw AppError.validation('Datos inválidos', [
        { field: 'to', message: `El rango máximo es de ${MAX_WEEKS} semanas` },
      ]);
    }
    return { start, end, weeks };
  }

  const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && aEnd >= bStart;

  return {
    /** % de dedicación por miembro activo y semana; días hábiles de ausencia informativos. */
    load(query) {
      const { start, end, weeks } = resolveRange(query);
      const members = db
        .prepare(
          `SELECT id, trim(first_name || ' ' || last_name) AS name FROM team_members
            WHERE is_active = 1 ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE, id`,
        )
        .all();
      const assignments = db
        .prepare(
          `SELECT team_member_id, allocation_percent, start_date, end_date FROM assignments
            WHERE start_date <= ? AND end_date >= ?`,
        )
        .all(end, start);
      const timeOff = db
        .prepare(
          `SELECT team_member_id, start_date, end_date FROM time_off
            WHERE start_date <= ? AND end_date >= ?`,
        )
        .all(end, start);

      const rows = members.map((m) => {
        const mine = assignments.filter((a) => a.team_member_id === m.id);
        const absentDays = new Set();
        for (const t of timeOff.filter((o) => o.team_member_id === m.id)) {
          for (let d = t.start_date; d <= t.end_date; d = addDays(d, 1)) {
            if (!isWeekend(d)) absentDays.add(d);
          }
        }
        return {
          id: m.id,
          name: m.name,
          weeks: weeks.map((w) => {
            const percent = mine
              .filter((a) => overlaps(a.start_date, a.end_date, w.start, w.end))
              .reduce((acc, a) => acc + a.allocation_percent, 0);
            let absenceDays = 0;
            for (let d = w.start; d <= w.end; d = addDays(d, 1))
              if (absentDays.has(d)) absenceDays += 1;
            return { percent, over: percent > 100, absenceDays };
          }),
        };
      });
      return { range: { from: start, to: end }, weeks, members: rows };
    },

    /** Matriz miembros × proyectos con la dedicación de las asignaciones que tocan el rango. */
    matrix(query) {
      const { start, end } = resolveRange(query);
      const rows = db
        .prepare(
          `SELECT a.team_member_id, trim(m.first_name || ' ' || m.last_name) AS member_name,
                  a.project_id, p.code, p.name AS project_name, a.allocation_percent
             FROM assignments a
             JOIN team_members m ON m.id = a.team_member_id
             JOIN projects p ON p.id = a.project_id
            WHERE a.start_date <= ? AND a.end_date >= ?
            ORDER BY p.code, member_name, a.id`,
        )
        .all(end, start);
      const projects = new Map();
      const members = new Map();
      for (const r of rows) {
        projects.set(r.project_id, { id: r.project_id, code: r.code, name: r.project_name });
        if (!members.has(r.team_member_id)) {
          members.set(r.team_member_id, {
            id: r.team_member_id,
            name: r.member_name,
            cells: {},
            totalPercent: 0,
          });
        }
        const member = members.get(r.team_member_id);
        member.cells[r.project_id] ??= { percent: 0 };
        member.cells[r.project_id].percent += r.allocation_percent;
        member.totalPercent += r.allocation_percent;
      }
      return {
        range: { from: start, to: end },
        projects: [...projects.values()],
        members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
      };
    },
  };
}
