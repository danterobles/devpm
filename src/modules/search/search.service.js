export const MIN_LENGTH = 2;

const STATUS = {
  projects: {
    planning: 'planeación',
    active: 'activo',
    on_hold: 'en pausa',
    completed: 'completado',
    cancelled: 'cancelado',
  },
  tasks: {
    backlog: 'backlog',
    todo: 'por hacer',
    in_progress: 'en progreso',
    in_review: 'en revisión',
    blocked: 'bloqueada',
    done: 'hecha',
  },
};

/** Búsqueda global (PRD §5.17): grupos con los primeros resultados, el total y un enlace a cada uno. */
export function createSearchService({ repository }) {
  return {
    search(text) {
      const q = String(text ?? '').trim();
      if (q.length < MIN_LENGTH) return { q, tooShort: true, groups: [] };
      const found = repository.search(q);
      const groups = [
        {
          key: 'projects',
          label: 'Proyectos',
          total: found.projects.total,
          moreHref: `/projects?q=${encodeURIComponent(q)}`,
          items: found.projects.rows.map((r) => ({
            title: `${r.code} · ${r.name}`,
            subtitle: STATUS.projects[r.status],
            href: `/projects/${r.id}`,
          })),
        },
        {
          key: 'tasks',
          label: 'Tareas',
          total: found.tasks.total,
          moreHref: null, // no hay un listado global de tareas
          items: found.tasks.rows.map((r) => ({
            title: r.title,
            subtitle: `${r.project_code} · ${STATUS.tasks[r.status]}`,
            href: `/tasks/${r.id}`,
          })),
        },
        {
          key: 'clients',
          label: 'Clientes',
          total: found.clients.total,
          moreHref: `/clients/internal?q=${encodeURIComponent(q)}`,
          items: found.clients.rows.map((r) => ({
            title: r.name,
            subtitle: `${r.type === 'internal' ? 'interno' : 'externo'}${r.is_active ? '' : ' · inactivo'}`,
            href: `/clients/${r.type}/${r.id}`,
          })),
        },
        {
          key: 'members',
          label: 'Equipo',
          total: found.members.total,
          moreHref: `/team?q=${encodeURIComponent(q)}`,
          items: found.members.rows.map((r) => ({
            title: r.name,
            subtitle: `${r.position}${r.is_active ? '' : ' · inactivo'}`,
            href: `/team/${r.id}`,
          })),
        },
      ];
      return { q, tooShort: false, total: groups.reduce((n, g) => n + g.total, 0), groups };
    },
  };
}
