import { AppError } from '../../lib/AppError.js';
import { SESSION_COOKIE } from './session.js';

const call = (fn, target) =>
  new Promise((resolve, reject) => fn.call(target, (err) => (err ? reject(err) : resolve())));

export function createAuthController({ service }) {
  return {
    showLogin(req, res) {
      if (req.session?.userId) return res.redirect('/');
      return res.render('pages/auth/login', { title: 'Iniciar sesión', error: null, email: '' });
    },

    async login(req, res) {
      const { email, password } = req.validated;
      let user;
      try {
        user = await service.authenticate(email, password);
      } catch (err) {
        if (err instanceof AppError && err.status === 401) {
          return res
            .status(401)
            .render('pages/auth/login', { title: 'Iniciar sesión', error: err.message, email });
        }
        throw err;
      }
      // Nuevo ID de sesión al autenticar: evita la fijación de sesión.
      await call(req.session.regenerate, req.session);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.fullName = user.fullName;
      await call(req.session.save, req.session);
      res.redirect('/');
    },

    async logout(req, res) {
      if (req.session) await call(req.session.destroy, req.session);
      res.clearCookie(SESSION_COOKIE);
      res.redirect('/login');
    },
  };
}
