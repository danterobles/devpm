import { addDays, today as todayIn } from '../../lib/dates.js';
import { businessDays, elapsedFraction, lastDays, ratio, round1, weekRange } from './calc.js';
import { DEFAULT_THRESHOLDS, semaphore } from './thresholds.js';

const round2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const pct = (n, d) => (ratio(n, d) === null ? null : (n / d) * 100);
const OPEN = ['planning', 'active', 'on_hold'];

/**
 * KPIs del tablero (PRD §6 y §6.1). Cada KPI es una función de los filtros y de «hoy»; las
 * divisiones entre cero producen `null` (la UI muestra «—»).
 * @param {{ repository: ReturnType<import('./kpi.repository.js').createKpiRepository>, timezone?: string, getThresholds?: () => typeof DEFAULT_THRESHOLDS }} deps
 */
export function createKpiService({
  repository,
  timezone = 'America/Mexico_City',
  getThresholds = () => DEFAULT_THRESHOLDS,
}) {
  /** Minutos de capacidad de los miembros en el rango: semanal ÷ 5 por día hábil, menos ausencias. */
  function capacityMinutes(members, from, to) {
    const days = businessDays(from, to);
    const absences = new Map();
    for (const t of repository.timeOff(from, to)) {
      if (!absences.has(t.member)) absences.set(t.member, new Set());
      for (
        let d = t.start_date > from ? t.start_date : from;
        d <= (t.end_date < to ? t.end_date : to);
        d = addDays(d, 1)
      ) {
        absences.get(t.member).add(d);
      }
    }
    return members.reduce((total, m) => {
      const absent = absences.get(m.id);
      const available = days.filter((d) => !absent?.has(d)).length;
      return total + (m.capacity / 5) * available;
    }, 0);
  }

  return {
    /**
     * @param {{ from?: string, to?: string, clientType?: string, clientId?: number, projectId?: number, managerId?: number }} filters
     * @param {{ today?: string, includeRevenue?: boolean }} [options]
     */
    getAll(filters = {}, { today = todayIn(timezone), includeRevenue = false } = {}) {
      const thresholds = getThresholds();
      // Periodo: lo indicado; sin `to` termina hoy; sin `from` abarca 30 días terminando en `to`.
      const to = filters.to ?? today;
      const range = { from: filters.from ?? lastDays(to, 30).from, to };
      const projects = repository.projects(filters);
      const ids = projects.map((p) => p.id);
      const active = projects.filter((p) => p.status === 'active');
      const activeIds = active.map((p) => p.id);
      const openIds = projects.filter((p) => OPEN.includes(p.status)).map((p) => p.id);

      // --- Avance, calendario y costo por proyecto activo (K2–K5) ---
      const points = new Map(repository.points(activeIds).map((r) => [r.project_id, r]));
      const spent = new Map(repository.spentMinutes(ids).map((r) => [r.project_id, r.minutes]));
      const lateMilestones = new Map(
        repository.overdueMilestones(activeIds, today).map((r) => [r.project_id, r.total]),
      );

      const perProject = active.map((p) => {
        const pts = points.get(p.id) ?? { total: 0, done: 0 };
        const progress = ratio(pts.done, pts.total) ?? 0; // 0–1 (sin puntos: sin avance)
        const elapsed = elapsedFraction(p.start_date, p.end_date, today);
        const actual = spent.get(p.id) ?? 0;
        const budget = p.budget_minutes;
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          budgetMinutes: budget,
          totalPoints: pts.total,
          donePoints: pts.done,
          progress,
          elapsed,
          earned: progress * budget, // EV
          planned: elapsed * budget, // PV
          actualMinutes: actual, // AC
          endDate: p.end_date,
          lateMilestones: lateMilestones.get(p.id) ?? 0,
        };
      });
      const withBudget = perProject.filter((p) => p.budgetMinutes > 0);
      const sum = (list, key) => list.reduce((acc, p) => acc + p[key], 0);

      const totalPoints = sum(perProject, 'totalPoints');
      const donePoints = sum(perProject, 'donePoints');
      const k2 = round1(pct(donePoints, totalPoints));
      const spi = ratio(sum(withBudget, 'earned'), sum(withBudget, 'planned'));
      const cpi = ratio(sum(withBudget, 'earned'), sum(withBudget, 'actualMinutes'));
      const consumption = pct(sum(withBudget, 'actualMinutes'), sum(withBudget, 'budgetMinutes'));

      // --- Horas, capacidad y utilización (K6, K13, K14, K16) ---
      const projectLevelFilter = Boolean(
        filters.clientType || filters.clientId || filters.projectId || filters.managerId,
      );
      const members = repository.activeMembers();
      const scopedMembers = (from, to) => {
        if (!projectLevelFilter) return members;
        const assigned = new Set(repository.assignedMemberIds(ids, from, to));
        return members.filter((m) => assigned.has(m.id));
      };
      const minutes = repository.minutesInRange(ids, range.from, range.to);
      const minutesWhere = (fn) => minutes.filter(fn).reduce((acc, r) => acc + r.minutes, 0);
      const loggedInRange = minutesWhere(() => true);
      const capacityInRange = capacityMinutes(
        scopedMembers(range.from, range.to),
        range.from,
        range.to,
      );
      const k6 = round1(pct(loggedInRange, capacityInRange));

      const week = weekRange(today);
      const loggedWeek = repository
        .minutesInRange(ids, week.from, week.to)
        .reduce((acc, r) => acc + r.minutes, 0);
      const capacityWeek = capacityMinutes(scopedMembers(week.from, week.to), week.from, week.to);
      const k16 = round1(pct(loggedWeek, capacityWeek));

      const byType = (type, billable) =>
        minutesWhere((r) => r.client_type === type && Boolean(r.billable) === billable);
      const revenue = repository.revenueRaw(ids, range.from, range.to).map((r) => ({
        currency: r.currency,
        cents: Math.round(r.minute_cents / 60),
      }));

      // --- K7: miembros sobreasignados, día por día en días hábiles ---
      const candidates = repository.assignedMemberIds(
        ids.filter((id) =>
          projects.find((p) => p.id === id && ['planning', 'active'].includes(p.status)),
        ),
        range.from,
        range.to,
      );
      const allocations = repository.allocations(candidates, range.from, range.to);
      const days = businessDays(range.from, range.to);
      const overallocated = candidates.filter((member) => {
        const mine = allocations.filter((a) => a.member === member);
        return days.some(
          (d) =>
            mine
              .filter((a) => a.start_date <= d && a.end_date >= d)
              .reduce((acc, a) => acc + a.percent, 0) > 100,
        );
      });

      // --- K8 y K9: sprints cerrados ---
      const closed = repository.closedSprints(ids, 3);
      const velocity = closed.map((s) => ({
        sprintId: s.id,
        name: s.name,
        projectCode: s.project_code,
        points: s.completed_points ?? 0,
      }));
      const committed = closed.reduce((acc, s) => acc + (s.committed_points ?? 0), 0);
      const completed = closed.reduce((acc, s) => acc + (s.completed_points ?? 0), 0);
      const k9 = round1(pct(completed, committed));

      // --- K10, K11, K12, K15 ---
      const k10 = repository.openTasksCount(openIds, { overdueBefore: today });
      const k11 = repository.openTasksCount(openIds, { status: 'blocked' });
      const cycle = repository.cycle(ids, range.from, range.to);
      const k15 = repository.overdueMilestones(openIds, today).reduce((acc, r) => acc + r.total, 0);

      const byStatus = Object.fromEntries(
        ['planning', 'active', 'on_hold', 'completed', 'cancelled'].map((s) => [
          s,
          projects.filter((p) => p.status === s).length,
        ]),
      );

      const k2Progress = k2;
      const kpis = {
        k1: { value: active.length, byStatus },
        k2: { value: k2, donePoints, totalPoints },
        k3: { value: round2(spi) },
        k4: {
          value: round2(cpi),
          earnedMinutes: Math.round(sum(withBudget, 'earned')),
          actualMinutes: sum(withBudget, 'actualMinutes'),
        },
        k5: { value: round1(consumption), progress: k2Progress },
        k6: {
          value: k6,
          loggedMinutes: loggedInRange,
          capacityMinutes: Math.round(capacityInRange),
        },
        k7: { value: overallocated.length, members: overallocated },
        k8: {
          value: velocity[0]?.points ?? null,
          average: closed.length ? round1(completed / closed.length) : null,
          history: velocity,
        },
        k9: { value: k9, completedPoints: completed, committedPoints: committed },
        k10: { value: k10 },
        k11: { value: k11 },
        k12: { value: round1(cycle.days), tasks: cycle.tasks },
        k13: {
          billableMinutes: minutesWhere((r) => Boolean(r.billable)),
          nonBillableMinutes: minutesWhere((r) => !r.billable),
          byClientType: {
            internal: {
              billableMinutes: byType('internal', true),
              nonBillableMinutes: byType('internal', false),
            },
            external: {
              billableMinutes: byType('external', true),
              nonBillableMinutes: byType('external', false),
            },
          },
        },
        k15: { value: k15 },
        k16: {
          value: k16,
          loggedMinutes: loggedWeek,
          capacityMinutes: Math.round(capacityWeek),
          week,
        },
      };
      if (includeRevenue) kpis.k14 = { byCurrency: revenue };
      for (const id of ['k3', 'k4', 'k5', 'k6', 'k7', 'k9', 'k10', 'k11', 'k15', 'k16']) {
        kpis[id].status = semaphore(id, kpis[id].value, thresholds, { progress: k2Progress });
      }

      // --- Tabla por proyecto activo y «Proyectos en riesgo» (RF-94) ---
      const rows = perProject.map((p) => {
        const hasBudget = p.budgetMinutes > 0;
        const pSpi = hasBudget ? ratio(p.earned, p.planned) : null;
        const pCpi = hasBudget ? ratio(p.earned, p.actualMinutes) : null;
        const pConsumption = hasBudget ? pct(p.actualMinutes, p.budgetMinutes) : null;
        const progressPct = p.totalPoints > 0 ? p.progress * 100 : null;
        const causes = [];
        if (pSpi !== null && pSpi < thresholds.k3.amber)
          causes.push({ code: 'SPI', message: `SPI ${round2(pSpi)} < ${thresholds.k3.amber}` });
        if (pCpi !== null && pCpi < thresholds.k4.amber)
          causes.push({ code: 'CPI', message: `CPI ${round2(pCpi)} < ${thresholds.k4.amber}` });
        if (p.endDate < today)
          causes.push({ code: 'OVERDUE', message: `Fecha fin vencida (${p.endDate})` });
        if (
          pConsumption !== null &&
          pConsumption > (progressPct ?? 0) + thresholds.k5.amberMargin
        ) {
          causes.push({
            code: 'OVERSPEND',
            message: `Consumo ${round1(pConsumption)} % > avance ${round1(progressPct ?? 0)} % + ${thresholds.k5.amberMargin}`,
          });
        }
        if (p.lateMilestones > 0)
          causes.push({ code: 'MILESTONE', message: `${p.lateMilestones} hito(s) vencido(s)` });
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          progress: round1(progressPct),
          spi: round2(pSpi),
          cpi: round2(pCpi),
          consumption: round1(pConsumption),
          endDate: p.endDate,
          causes,
        };
      });
      return {
        filters: { ...filters, ...range },
        range,
        today,
        kpis,
        projects: rows,
        risk: rows.filter((r) => r.causes.length > 0),
      };
    },
  };
}
