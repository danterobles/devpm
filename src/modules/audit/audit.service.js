export const ENTITY_LABELS = {
  client: 'Cliente',
  team_member: 'Miembro del equipo',
  skill: 'Habilidad',
  time_off: 'Ausencia',
  project: 'Proyecto',
  milestone: 'Hito',
  assignment: 'Asignación',
  sprint: 'Sprint',
  task: 'Tarea',
  time_entry: 'Registro de tiempo',
  user: 'Usuario',
  setting: 'Configuración',
  task_comment: 'Comentario',
  task_attachment: 'Adjunto',
};
export const ACTION_LABELS = {
  create: 'Alta',
  update: 'Cambio',
  delete: 'Baja',
  status_change: 'Cambio de estado',
};

const SENSITIVE = /password|hash|secret|token|totp/i;
const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** `{campo: [antes, después]}` → lista legible; los campos sensibles nunca muestran su valor. */
export function describeChanges(json) {
  let changes;
  try {
    changes = JSON.parse(json ?? 'null');
  } catch {
    return [];
  }
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes).map(([field, pair]) => {
    const [before, after] = Array.isArray(pair) ? pair : [null, pair];
    return SENSITIVE.test(field)
      ? { field, before: '(oculto)', after: '(oculto)' }
      : { field, before: show(before), after: show(after) };
  });
}

/** Bitácora de datos para el administrador (PRD §5.19). */
export function createAuditService({ repository }) {
  return {
    list(filters) {
      const { rows, total } = repository.list(filters);
      return {
        data: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          userId: r.user_id,
          userName: r.user_name,
          entity: r.entity,
          entityLabel: ENTITY_LABELS[r.entity] ?? r.entity,
          entityId: r.entity_id,
          action: r.action,
          actionLabel: ACTION_LABELS[r.action] ?? r.action,
          changes: describeChanges(r.changes),
        })),
        meta: { page: filters?.page ?? 1, pageSize: filters?.pageSize ?? 50, total },
      };
    },
    options: () => ({ entities: repository.entities(), users: repository.users() }),
  };
}
