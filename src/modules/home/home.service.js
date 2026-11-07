import { addDays, today as todayIn, weekday } from '../../lib/dates.js';

const hours = (minutes) => Math.round((minutes / 60) * 10) / 10;
const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : null);

/**
 * Panel «Mi día» por rol (PRD §5.13). Solo lectura: cada sección respeta lo que ese rol ya puede
 * ver en el resto de la aplicación.
 * @param {{ repository: object, notifications: object, kpi: { getAll: Function }, timezone?: string }} deps
 */
export function createHomeService({
  repository,
  notifications,
  kpi,
  timezone = 'America/Mexico_City',
}) {
  function mine(member, today) {
    const weekStart = addDays(today, -((weekday(today) + 6) % 7));
    const weekEnd = addDays(weekStart, 6);
    const byStatus = repository.entriesByStatus(member.id, weekStart, weekEnd);
    const logged = repository.loggedMinutes(member.id, weekStart, weekEnd);
    return {
      tasks: repository.openTasks(member.id).map((t) => ({
        ...t,
        overdue: t.due_date !== null && t.due_date < today,
      })),
      week: {
        start: weekStart,
        end: weekEnd,
        loggedHours: hours(logged),
        capacityHours: hours(member.capacity),
        percent: pct(logged, member.capacity),
        toSend: (byStatus.draft ?? 0) + (byStatus.rejected ?? 0),
        submitted: byStatus.submitted ?? 0,
      },
      rejected: repository.rejectedEntries(member.id).map((r) => ({
        ...r,
        hours: hours(r.minutes),
      })),
    };
  }

  function lead(actor, member, today) {
    const scopeManager = actor.role === 'admin' ? null : (member?.id ?? -1); // -1: sin miembro → nada
    const until = addDays(today, 7);
    const risk = kpi.getAll({}, { includeRevenue: false }).risk;
    const mineIds = new Set(
      actor.role === 'admin' || !member ? [] : repository.managedProjectIds(member.id),
    );
    const visibleRisk = actor.role === 'admin' ? risk : risk.filter((p) => mineIds.has(p.id));
    return {
      pendingApprovals: repository.pendingApprovals(scopeManager, member?.id ?? null),
      risk: visibleRisk.slice(0, 5).map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        causes: p.causes.map((c) => c.message),
      })),
      milestones: repository
        .milestonesUntil(until, scopeManager)
        .map((m) => ({ ...m, overdue: m.due_date < today })),
      blocked: repository.blockedTasks(scopeManager),
    };
  }

  return {
    /** @param {{ id: number, role: string }} actor */
    forUser(actor, today = todayIn(timezone)) {
      const member = actor.role === 'viewer' ? null : repository.memberOf(actor.id);
      const unread = notifications.list(actor.id, { unreadOnly: true, pageSize: 5 });
      const panel = {
        role: actor.role,
        today,
        notifications: unread.data,
        unreadTotal: unread.meta.total,
        mine: member ? mine(member, today) : null,
        lead: ['admin', 'pm'].includes(actor.role) ? lead(actor, member, today) : null,
        projects: null,
      };
      if (actor.role === 'viewer') {
        panel.projects = repository.activeProjects().map((p) => ({
          ...p,
          percent: pct(p.done, p.total),
        }));
      }
      return panel;
    },
  };
}
