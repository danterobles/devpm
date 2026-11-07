import { AppError } from '../../lib/AppError.js';
import { now } from '../../lib/dates.js';
import { SESSION_COOKIE } from './session.js';

const call = (fn, target) =>
  new Promise((resolve, reject) => fn.call(target, (err) => (err ? reject(err) : resolve())));

/** El segundo paso debe completarse en 10 minutos desde la contraseña. */
export const TWO_FACTOR_WINDOW_MS = 10 * 60 * 1000;

export function createAuthController({
  service,
  logger = null,
  securityEvents = null,
  accountSecurity = null,
  repository = null,
}) {
  /** Sesión nueva y autenticada (nuevo ID: sin fijación de sesión). */
  async function startSession(req, user) {
    await call(req.session.regenerate, req.session);
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.fullName = user.fullName;
    await call(req.session.save, req.session);
    securityEvents?.record('login_success', { userId: user.id, email: user.email, ip: req.ip });
  }

  const twoFactorUser = (req) => {
    const id = req.session?.twoFactorUserId;
    const at = req.session?.twoFactorAt;
    return Number.isInteger(id) && now().getTime() - at < TWO_FACTOR_WINDOW_MS ? id : null;
  };
  const render2fa = (res, extra = {}) =>
    res.render('pages/auth/twofa', { title: 'Verificación en dos pasos', error: null, ...extra });

  return {
    showLogin(req, res) {
      if (req.session?.userId) return res.redirect('/');
      return res.render('pages/auth/login', {
        title: 'Iniciar sesión',
        error: null,
        email: '',
        notice:
          req.query.reset === '1' ? 'Contraseña actualizada. Inicia sesión con la nueva.' : null,
        mailAvailable: Boolean(accountSecurity?.mailAvailable()),
      });
    },

    async login(req, res) {
      const { email, password } = req.validated;
      let user;
      try {
        user = await service.authenticate(email, password);
      } catch (err) {
        if (err instanceof AppError && err.status === 401) {
          logger?.warn({ event: 'login.failed', ip: req.ip, email }, 'Inicio de sesión fallido');
          securityEvents?.record('login_failed', { email, ip: req.ip });
          return res.status(401).render('pages/auth/login', {
            title: 'Iniciar sesión',
            error: err.message,
            email,
            notice: null,
            mailAvailable: Boolean(accountSecurity?.mailAvailable()),
          });
        }
        throw err;
      }
      if (user.totpEnabled) {
        // Contraseña correcta, falta el segundo paso: la sesión NO queda autenticada (no hay userId).
        await call(req.session.regenerate, req.session);
        req.session.twoFactorUserId = user.id;
        req.session.twoFactorAt = now().getTime();
        await call(req.session.save, req.session);
        return res.redirect('/login/2fa');
      }
      await startSession(req, user);
      return res.redirect('/');
    },

    showTwoFactor(req, res) {
      if (req.session?.userId) return res.redirect('/');
      if (twoFactorUser(req) === null) return res.redirect('/login');
      return render2fa(res);
    },

    async twoFactor(req, res) {
      const userId = twoFactorUser(req);
      if (userId === null) return res.redirect('/login');
      const code = String(req.body?.code ?? '').slice(0, 40);
      if (!accountSecurity?.verifyLogin(userId, code, req.ip)) {
        return render2fa(res.status(401), { error: 'El código no es correcto' });
      }
      const user = repository.findSessionUser(userId);
      if (!user) return res.redirect('/login');
      await startSession(req, user);
      return res.redirect('/');
    },

    async logout(req, res) {
      if (req.session) await call(req.session.destroy, req.session);
      res.clearCookie(SESSION_COOKIE);
      res.redirect('/login');
    },
  };
}
