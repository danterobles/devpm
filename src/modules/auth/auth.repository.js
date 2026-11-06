export function createAuthRepository(db) {
  const byEmail = db.prepare(
    `SELECT id, email, password_hash, full_name, role, is_active
       FROM users WHERE email = ?`,
  );
  const touchLogin = db.prepare(
    `UPDATE users
        SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
  );
  return {
    findByEmail: (email) => byEmail.get(email),
    touchLastLogin: (id) => touchLogin.run(id),
  };
}
