/** Acceso a datos de los filtros guardados (DATA §3.19). Cada consulta va acotada al dueño. */
export function createSavedFiltersRepository(db) {
  const q = {
    list: db.prepare(
      'SELECT id, scope, name, query FROM saved_filters WHERE user_id = ? ORDER BY scope, name COLLATE NOCASE',
    ),
    listScope: db.prepare(
      'SELECT id, scope, name, query FROM saved_filters WHERE user_id = ? AND scope = ? ORDER BY name COLLATE NOCASE',
    ),
    count: db.prepare('SELECT count(*) FROM saved_filters WHERE user_id = ?').pluck(),
    byName: db.prepare(
      'SELECT id FROM saved_filters WHERE user_id = ? AND scope = ? AND name = ? COLLATE NOCASE',
    ),
    insert: db.prepare(
      'INSERT INTO saved_filters (user_id, scope, name, query) VALUES (?, ?, ?, ?)',
    ),
    find: db.prepare(
      'SELECT id, scope, name, query FROM saved_filters WHERE id = ? AND user_id = ?',
    ),
    remove: db.prepare('DELETE FROM saved_filters WHERE id = ? AND user_id = ?'),
  };
  return {
    list: (userId, scope) => (scope ? q.listScope.all(userId, scope) : q.list.all(userId)),
    count: (userId) => q.count.get(userId),
    nameTaken: (userId, scope, name) => Boolean(q.byName.get(userId, scope, name)),
    insert: (userId, scope, name, query) =>
      Number(q.insert.run(userId, scope, name, query).lastInsertRowid),
    find: (id, userId) => q.find.get(id, userId),
    remove: (id, userId) => q.remove.run(id, userId).changes === 1,
  };
}
