import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../lib/AppError.js';
import { recordAudit } from '../../lib/audit.js';
import { generateSecret, otpauthUri, stepOf, verifyTotp } from '../../lib/totp.js';

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora
export const RECOVERY_CODES = 10;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const normalizeCode = (code) =>
  String(code ?? '')
    .toLowerCase()
    .replace(/[\s-]/g, '');
const newRecoveryCode = () => {
  const hex = randomBytes(5).toString('hex'); // 10 caracteres
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
};

/**
 * Recuperación de contraseña y autenticación en dos pasos (PRD §5.18). Los enlaces y los códigos de
 * recuperación se guardan solo como hash; el secreto TOTP, cifrado. Nada de lo que devuelve revela si
 * una cuenta existe.
 */
export function createAccountSecurityService({
  db,
  repository,
  mailer = null,
  appUrl = 'http://localhost:3000',
  sessionStore = () => null,
  events = null,
  secretBox,
  bcryptCost = 12,
  clock = () => Date.now(),
}) {
  const audit = (actorId, userId, changes) =>
    recordAudit(db, {
      userId: actorId,
      entity: 'user',
      entityId: userId,
      action: 'update',
      changes,
    });
  const record = (type, data) => events?.record(type, data);

  function requireUser(id) {
    const user = repository.findUser(id);
    if (!user || user.is_active !== 1) throw AppError.notFound('Usuario no encontrado');
    return user;
  }
  const secretOf = (user) => (user.totp_secret ? secretBox.decrypt(user.totp_secret) : null);

  /** Verifica un código TOTP o de recuperación de la cuenta. No registra eventos. */
  function checkCode(user, code) {
    const secret = secretOf(user);
    if (secret) {
      const step = verifyTotp(secret, code, { timeMs: clock(), afterStep: user.totp_last_step });
      if (step !== null) {
        repository.setLastStep(user.id, step);
        return 'totp';
      }
    }
    const clean = normalizeCode(code);
    if (/^[a-f0-9]{10}$/.test(clean) && repository.useCode(user.id, sha256(clean)))
      return 'recovery';
    return null;
  }

  function newCodes(userId) {
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    repository.replaceCodes(
      userId,
      codes.map((c) => sha256(normalizeCode(c))),
    );
    return codes;
  }

  return {
    mailAvailable: () => Boolean(mailer?.enabled),

    // ---- Recuperación de contraseña (RF-160, RF-161) ----
    /** Siempre responde igual; solo cambia si el servidor puede enviar correo. */
    requestReset(email, ip) {
      if (!mailer?.enabled) return { mailAvailable: false };
      const user = repository.findUserByEmail(String(email ?? '').trim());
      if (!user || user.is_active !== 1) {
        record('password_reset_requested', { email, ip, detail: 'cuenta inexistente o inactiva' });
        return { mailAvailable: true };
      }
      const token = randomBytes(32).toString('hex');
      db.transaction(() => {
        repository.invalidateResets(user.id);
        repository.createReset(
          user.id,
          sha256(token),
          new Date(clock() + RESET_TTL_MS).toISOString(),
        );
      })();
      record('password_reset_requested', { userId: user.id, email: user.email, ip });
      void mailer.send({
        to: user.email,
        subject: '[DevPM] Restablece tu contraseña',
        text:
          `Hola ${user.full_name}:\n\nRecibimos una solicitud para restablecer tu contraseña de DevPM.\n` +
          `Abre este enlace (sirve una sola vez y vence en 1 hora):\n\n${appUrl}/reset-password?token=${token}\n\n` +
          'Si no lo solicitaste, ignora este mensaje: tu contraseña no cambia.\n',
      });
      return { mailAvailable: true };
    },

    /** ¿El enlace sirve todavía? (existe, no se usó, no venció y la cuenta está activa) */
    tokenUserId(token) {
      if (!/^[a-f0-9]{64}$/.test(String(token ?? ''))) return null;
      const row = repository.findReset(sha256(token));
      if (!row || row.used_at !== null || Date.parse(row.expires_at) <= clock()) return null;
      const user = repository.findUser(row.user_id);
      return user?.is_active === 1 ? user.id : null;
    },

    async resetPassword(token, newPassword, ip) {
      const userId = this.tokenUserId(token);
      if (userId === null)
        throw AppError.validation('Enlace inválido', [
          { field: 'token', message: 'El enlace no es válido o ya venció' },
        ]);
      const hash = await bcrypt.hash(newPassword, bcryptCost);
      const used = db.transaction(() => {
        if (!repository.markResetUsed(repository.findReset(sha256(token)).id)) return false; // otro lo usó antes
        repository.setPassword(userId, hash);
        repository.invalidateResets(userId);
        audit(userId, userId, { password: [null, '(restablecida)'] });
        return true;
      })();
      if (!used)
        throw AppError.validation('Enlace inválido', [
          { field: 'token', message: 'El enlace no es válido o ya venció' },
        ]);
      sessionStore()?.destroyByUser(userId);
      record('password_reset_completed', { userId, email: repository.findUser(userId).email, ip });
      return userId;
    },

    // ---- Dos pasos (RF-162 a RF-165) ----
    status(userId) {
      const user = requireUser(userId);
      return {
        enabled: user.totp_enabled === 1,
        pending: user.totp_enabled === 0 && Boolean(user.totp_secret),
        recoveryCodesLeft: repository.unusedCodeCount(userId),
      };
    },
    /** Clave y enlace para la app de autenticación (la clave pendiente se conserva hasta activar). */
    beginSetup(userId) {
      const user = requireUser(userId);
      if (user.totp_enabled === 1) throw AppError.businessRule('Ya tienes activados los dos pasos');
      const secret = generateSecret();
      repository.setSecret(userId, secretBox.encrypt(secret));
      return { secret, uri: otpauthUri({ secret, account: user.email }) };
    },
    pendingSetup(userId) {
      const user = requireUser(userId);
      const secret = user.totp_enabled === 0 ? secretOf(user) : null;
      return secret ? { secret, uri: otpauthUri({ secret, account: user.email }) } : null;
    },
    enable(userId, code, ip) {
      const user = requireUser(userId);
      if (user.totp_enabled === 1) throw AppError.businessRule('Ya tienes activados los dos pasos');
      const secret = secretOf(user);
      const step = secret ? verifyTotp(secret, code, { timeMs: clock() }) : null;
      if (step === null) {
        throw AppError.validation('Código incorrecto', [
          {
            field: 'code',
            message:
              'El código no es correcto; revisa la hora de tu dispositivo e inténtalo de nuevo',
          },
        ]);
      }
      const codes = db.transaction(() => {
        repository.enable(userId, step);
        audit(userId, userId, { totp_enabled: [0, 1] });
        return newCodes(userId);
      })();
      record('twofa_enabled', { userId, email: user.email, ip });
      return codes;
    },
    /** Comprueba el código del segundo paso al iniciar sesión. */
    verifyLogin(userId, code, ip) {
      const user = repository.findUser(userId);
      if (!user || user.is_active !== 1 || user.totp_enabled !== 1) return false;
      const method = checkCode(user, code);
      if (method === null) {
        record('twofa_failed', { userId, email: user.email, ip });
        return false;
      }
      if (method === 'recovery') record('recovery_code_used', { userId, email: user.email, ip });
      return true;
    },
    async disable(userId, password, code, ip) {
      const user = requireUser(userId);
      if (user.totp_enabled !== 1) throw AppError.businessRule('No tienes activados los dos pasos');
      const okPassword = await bcrypt.compare(
        String(password ?? ''),
        repository.passwordHash(userId),
      );
      if (!okPassword || checkCode(user, code) === null) {
        record('twofa_failed', { userId, email: user.email, ip, detail: 'al desactivar' });
        throw AppError.validation('Datos inválidos', [
          { field: 'code', message: 'La contraseña o el código no son correctos' },
        ]);
      }
      db.transaction(() => {
        repository.clearTotp(userId);
        repository.deleteCodes(userId);
        audit(userId, userId, { totp_enabled: [1, 0] });
      })();
      record('twofa_disabled', { userId, email: user.email, ip });
    },
    /** Códigos de recuperación nuevos (los anteriores dejan de servir); exige un código TOTP vigente. */
    regenerateCodes(userId, code, ip) {
      const user = requireUser(userId);
      const secret = user.totp_enabled === 1 ? secretOf(user) : null;
      const step = secret
        ? verifyTotp(secret, code, { timeMs: clock(), afterStep: user.totp_last_step })
        : null;
      if (step === null) {
        record('twofa_failed', { userId, email: user.email, ip, detail: 'al renovar códigos' });
        throw AppError.validation('Código incorrecto', [
          { field: 'code', message: 'El código no es correcto' },
        ]);
      }
      repository.setLastStep(userId, step);
      return newCodes(userId);
    },
    /** El administrador quita el 2FA de una persona que perdió su dispositivo (RF-165). */
    adminReset(adminId, userId, ip) {
      const user = repository.findUser(userId);
      if (!user) throw AppError.notFound('Usuario no encontrado');
      db.transaction(() => {
        repository.clearTotp(userId);
        repository.deleteCodes(userId);
        audit(adminId, userId, { totp_enabled: [user.totp_enabled, 0] });
      })();
      record('twofa_reset_by_admin', {
        userId,
        email: user.email,
        ip,
        detail: `administrador ${adminId}`,
      });
    },
    isEnabled: (userId) => repository.findUser(userId)?.totp_enabled === 1,
    stepNow: () => stepOf(clock()),
  };
}
