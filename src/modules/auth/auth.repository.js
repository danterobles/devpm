export function createAuthRepository(db) {
  const byEmail = db.prepare(
    `SELECT id, email, password_hash, full_name, role, is_active, totp_enabled
       FROM users WHERE email = ?`,
  );
  const touchLogin = db.prepare(
    `UPDATE users
        SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
  );
  const sessionUser = db.prepare(
    'SELECT id, email, full_name, role FROM users WHERE id = ? AND is_active = 1',
  );
  return {
    findSessionUser(id) {
      const u = sessionUser.get(id);
      return u ? { id: u.id, email: u.email, fullName: u.full_name, role: u.role } : null;
    },
    findByEmail: (email) => byEmail.get(email),
    touchLastLogin: (id) => touchLogin.run(id),
  };
}
