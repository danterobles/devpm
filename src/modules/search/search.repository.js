const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Búsqueda global de solo lectura (PRD §5.17). Solo se consultan y devuelven columnas que los
 * listados ya muestran a cualquier usuario autenticado: nunca RFC, tarifas ni costos.
 */
export function createSearchRepository(db) {
  const group = (select, from, where, order) => ({
    rows: db.prepare(
      `${select} ${from} WHERE ${where}
       ORDER BY CASE WHEN ${order.prefix} THEN 0 ELSE 1 END, ${order.by} LIMIT 10`,
    ),
    total: db.prepare(`SELECT count(*) ${from} WHERE ${where}`).pluck(),
  });
  const LIKE = (col) => `${col} LIKE @q ESCAPE '\\'`;
  const PREFIX = (col) => `${col} LIKE @p ESCAPE '\\'`;
  const name = "(first_name || ' ' || last_name)";
  const q = {
    projects: group(
      'SELECT id, code, name, status',
      'FROM projects',
      `${LIKE('code')} OR ${LIKE('name')}`,
      { prefix: `${PREFIX('code')} OR ${PREFIX('name')}`, by: 'code' },
    ),
    tasks: group(
      'SELECT t.id, t.title, t.status, p.code AS project_code',
      'FROM tasks t JOIN projects p ON p.id = t.project_id',
      LIKE('t.title'),
      { prefix: PREFIX('t.title'), by: 't.title' },
    ),
    clients: group(
      'SELECT id, type, name, is_active',
      'FROM clients',
      `${LIKE('name')} OR ${LIKE('legal_name')}`,
      { prefix: PREFIX('name'), by: 'name' },
    ),
    members: group(
      `SELECT id, ${name} AS name, position, is_active`,
      'FROM team_members',
      `${LIKE(name)} OR ${LIKE('email')}`,
      { prefix: PREFIX(name), by: name },
    ),
  };
  return {
    /** @returns {Record<string, { rows: object[], total: number }>} */
    search(text) {
      const params = { q: `%${escapeLike(text)}%`, p: `${escapeLike(text)}%` };
      return Object.fromEntries(
        Object.entries(q).map(([key, g]) => [
          key,
          { rows: g.rows.all(params), total: g.total.get(params) },
        ]),
      );
    },
  };
}
