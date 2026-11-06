import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  ROLES,
  createUserSchema,
  idParamSchema,
  listQuerySchema,
  updateUserSchema,
} from './users.schemas.js';

const parseId = (raw) => {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Usuario no encontrado');
  return parsed.data;
};

const formView = (res, { status = 200, user, error = null, editing }) =>
  res.status(status).render('pages/admin/users/form', {
    title: editing ? 'Editar usuario' : 'Nuevo usuario',
    roles: ROLES,
    user,
    error,
    editing,
  });

export function createUsersController({ service }) {
  const actor = (req) => req.session.userId;

  /** Ejecuta `action`; si falla con un error de negocio, vuelve a mostrar el formulario con el mensaje. */
  async function withForm(res, view, action) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof AppError && err.status < 500 && err.status !== 404) {
        const detail = err.details?.[0]?.message;
        return formView(res, { ...view, status: err.status, error: detail ?? err.message });
      }
      throw err;
    }
  }

  return {
    // ---- API JSON ----
    apiList: (req, res) => res.json(service.list(parseWith(listQuerySchema, req.query))),
    apiGet: (req, res) => res.json({ data: service.get(parseId(req.params.id)) }),
    async apiCreate(req, res) {
      const input = parseWith(createUserSchema, req.body);
      res.status(201).json({ data: await service.create(actor(req), input) });
    },
    async apiUpdate(req, res) {
      const id = parseId(req.params.id);
      const input = parseWith(updateUserSchema, req.body);
      res.json({ data: await service.update(actor(req), id, input) });
    },
    async apiDeactivate(req, res) {
      await service.deactivate(actor(req), parseId(req.params.id));
      res.status(204).end();
    },

    // ---- Vistas HTML ----
    htmlList(req, res) {
      const query = parseWith(listQuerySchema, req.query);
      const { data, meta } = service.list(query);
      const params = new URLSearchParams();
      if (query.q) params.set('q', query.q);
      if (query.status !== 'all') params.set('status', query.status);
      const qs = params.toString();
      res.render('pages/admin/users/index', {
        title: 'Usuarios',
        users: data,
        meta,
        query,
        baseUrl: `/admin/users${qs ? `?${qs}` : ''}`,
      });
    },
    htmlNew: (_req, res) =>
      formView(res, { user: { role: 'developer', isActive: true }, editing: false }),
    htmlEdit: (req, res) =>
      formView(res, { user: service.get(parseId(req.params.id)), editing: true }),
    async htmlCreate(req, res) {
      const { email, fullName, role, teamMemberId } = req.body;
      const view = {
        user: { email, fullName, role, teamMemberId, isActive: true },
        editing: false,
      };
      return withForm(res, view, async () => {
        await service.create(actor(req), parseWith(createUserSchema, req.body));
        res.redirect('/admin/users');
      });
    },
    async htmlUpdate(req, res) {
      const id = parseId(req.params.id);
      const current = service.get(id);
      const { email, fullName, role, teamMemberId, password } = req.body;
      const isActive = req.body.isActive === '1';
      const view = {
        user: { ...current, email, fullName, role, teamMemberId, isActive },
        editing: true,
      };
      return withForm(res, view, async () => {
        const input = parseWith(updateUserSchema, {
          email,
          fullName,
          role,
          teamMemberId,
          password,
          isActive,
        });
        await service.update(actor(req), id, input);
        res.redirect('/admin/users');
      });
    },
  };
}
