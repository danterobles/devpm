/** Acceso a datos de recuperación de contraseña y 2FA (DATA §3.20). */
export function createAccountSecurityRepository(db) {
  const q = {
    user: db.prepare(
      `SELECT id, email, full_name, role, is_active, totp_secret, totp_enabled, totp_last_step
         FROM users WHERE id = ?`,
    ),
    userByEmail: db.prepare(
      'SELECT id, email, full_name, is_active FROM users WHERE lower(email) = lower(?)',
    ),
    setPassword: db.prepare(
      "UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ),
    passwordHash: db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck(),
    setSecret: db.prepare(
      'UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = NULL WHERE id = ?',
    ),
    enable: db.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?'),
    setLastStep: db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?'),
    clear: db.prepare(
      'UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?',
    ),
    deleteCodes: db.prepare('DELETE FROM recovery_codes WHERE user_id = ?'),
    insertCode: db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)'),
    useCode: db.prepare(
      `UPDATE recovery_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    ),
    unusedCodes: db
      .prepare('SELECT count(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
      .pluck(),
    expireResets: db.prepare(
      "UPDATE password_resets SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND used_at IS NULL",
    ),
    insertReset: db.prepare(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    ),
    findReset: db.prepare(
      `SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?`,
    ),
    useReset: db.prepare(
      "UPDATE password_resets SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND used_at IS NULL",
    ),
    pruneResets: db.prepare('DELETE FROM password_resets WHERE expires_at < ?'),
  };
  return {
    findUser: (id) => q.user.get(id) ?? null,
    findUserByEmail: (email) => q.userByEmail.get(email) ?? null,
    passwordHash: (id) => q.passwordHash.get(id),
    setPassword: (id, hash) => q.setPassword.run(hash, id),
    setSecret: (id, blob) => q.setSecret.run(blob, id),
    enable: (id, step) => q.enable.run(step, id),
    setLastStep: (id, step) => q.setLastStep.run(step, id),
    clearTotp: (id) => q.clear.run(id),
    replaceCodes(id, hashes) {
      q.deleteCodes.run(id);
      for (const h of hashes) q.insertCode.run(id, h);
    },
    deleteCodes: (id) => q.deleteCodes.run(id),
    useCode: (id, hash) => q.useCode.run(id, hash).changes === 1,
    unusedCodeCount: (id) => q.unusedCodes.get(id),
    invalidateResets: (id) => q.expireResets.run(id),
    createReset: (id, hash, expiresAt) => q.insertReset.run(id, hash, expiresAt),
    findReset: (hash) => q.findReset.get(hash) ?? null,
    markResetUsed: (id) => q.useReset.run(id).changes === 1,
    pruneResets: (beforeIso) => q.pruneResets.run(beforeIso).changes,
  };
}
