/** Acceso a datos de las notificaciones (DATA §3.16). SQL solo con parámetros. */
export function createNotificationsRepository(db) {
  const toDto = (r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    createdAt: r.created_at,
    readAt: r.read_at,
    isRead: r.read_at !== null,
  });
  const q = {
    insert: db.prepare(
      `INSERT OR IGNORE INTO notifications (user_id, type, title, body, link, dedupe_key)
       VALUES (@userId, @type, @title, @body, @link, @dedupeKey)`,
    ),
    unread: db
      .prepare('SELECT count(*) FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .pluck(),
    byId: db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?'),
    markRead: db.prepare(
      `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    ),
    markAll: db.prepare(
      `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE user_id = ? AND read_at IS NULL`,
    ),
    prune: db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?'),
    recipient: db.prepare(
      'SELECT id, email, full_name, email_notifications FROM users WHERE id = ? AND is_active = 1',
    ),
    setEmailPref: db.prepare(
      `UPDATE users SET email_notifications = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ),
    emailPref: db.prepare('SELECT email_notifications FROM users WHERE id = ?').pluck(),
    userOfMember: db
      .prepare('SELECT id FROM users WHERE team_member_id = ? AND is_active = 1')
      .pluck(),
    admins: db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").pluck(),
    managerOf: db.prepare('SELECT manager_id FROM projects WHERE id = ?').pluck(),
  };

  return {
    /** @returns {number|null} id creado, o null si la clave de deduplicación ya existía */
    insert({ userId, type, title, body, link = null, dedupeKey = null }) {
      const info = q.insert.run({ userId, type, title, body, link, dedupeKey });
      return info.changes === 1 ? Number(info.lastInsertRowid) : null;
    },
    unreadCount: (userId) => q.unread.get(userId),
    find(id, userId) {
      const row = q.byId.get(id, userId);
      return row ? toDto(row) : null;
    },
    list(userId, { unreadOnly = false, page = 1, pageSize = 20 } = {}) {
      const where = unreadOnly ? 'AND read_at IS NULL' : '';
      const total = db
        .prepare(`SELECT count(*) FROM notifications WHERE user_id = ? ${where}`)
        .pluck()
        .get(userId);
      const rows = db
        .prepare(
          `SELECT * FROM notifications WHERE user_id = ? ${where}
           ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(userId, pageSize, (page - 1) * pageSize);
      return { rows: rows.map(toDto), total };
    },
    markRead: (id, userId) => q.markRead.run(id, userId).changes === 1,
    markAllRead: (userId) => q.markAll.run(userId).changes,
    prune: (beforeIso) => q.prune.run(beforeIso).changes,
    recipient: (userId) => q.recipient.get(userId) ?? null,
    emailPreference: (userId) => q.emailPref.get(userId) === 1,
    setEmailPreference: (userId, enabled) => q.setEmailPref.run(enabled ? 1 : 0, userId),
    userOfMember: (memberId) => (memberId == null ? null : (q.userOfMember.get(memberId) ?? null)),
    activeAdmins: () => q.admins.all(),
    managerOfProject: (projectId) => q.managerOf.get(projectId) ?? null,
  };
}
