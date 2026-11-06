import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  POSITIONS,
  SENIORITIES,
  createMemberSchema,
  idParamSchema,
  listQuerySchema,
  updateMemberSchema,
} from './team.schemas.js';

const PRIVILEGED = ['admin', 'pm'];
const isPrivileged = (req) => PRIVILEGED.includes(req.session.role);

const parseId = (raw) => {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Miembro no encontrado');
  return parsed.data;
};

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const hoursToMinutes = (text) =>
  DECIMAL.test(String(text ?? '').trim()) ? Math.round(Number(text) * 60) : null;
const pesosToCents = (text) =>
  DECIMAL.test(String(text ?? '').trim()) ? Math.round(Number(text) * 100) : null;
export const minutesToHours = (m) => (m === null || m === undefined ? '' : String(m / 60));
export const centsToPesos = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

/** Mapea el cuerpo del formulario al contrato de la API (mismos esquemas Zod). */
function formToInput(body) {
  const input = {};
  for (const key of ['firstName', 'lastName', 'email', 'position', 'seniority', 'hireDate']) {
    if (body[key] !== undefined) input[key] = body[key];
  }
  const minutes = hoursToMinutes(body.weeklyHours);
  const cents = pesosToCents(body.hourlyCost);
  const details = [];
  if (minutes === null)
    details.push({ field: 'weeklyHours', message: 'Horas semanales inválidas' });
  if (cents === null) details.push({ field: 'hourlyCost', message: 'Costo por hora inválido' });
  if (details.length > 0) throw AppError.validation('Datos inválidos', details);
  return { ...input, weeklyCapacityMinutes: minutes, hourlyCostCents: cents };
}

const formView = (res, { status = 200, member, error = null, editing, canWrite }) =>
  res.status(status).render('pages/team/form', {
    title: editing ? (canWrite ? 'Editar miembro' : 'Ficha del miembro') : 'Nuevo miembro',
    positions: POSITIONS,
    seniorities: SENIORITIES,
    member,
    error,
    editing,
    canWrite,
  });

export function createTeamController({ service }) {
  const actor = (req) => req.session.userId;
  const opts = (req) => ({ includeCost: isPrivileged(req) });

  async function withForm(res, view, action) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof AppError && err.status < 500 && err.status !== 404) {
        return formView(res, {
          ...view,
          status: err.status,
          error: err.details?.[0]?.message ?? err.message,
        });
      }
      throw err;
    }
  }

  return {
    // ---- API JSON ----
    apiList: (req, res) => res.json(service.list(parseWith(listQuerySchema, req.query), opts(req))),
    apiGet: (req, res) => res.json({ data: service.get(parseId(req.params.id), opts(req)) }),
    apiCreate(req, res) {
      const input = parseWith(createMemberSchema, req.body);
      res.status(201).json({ data: service.create(actor(req), input) });
    },
    apiUpdate(req, res) {
      const id = parseId(req.params.id);
      const input = parseWith(updateMemberSchema, req.body);
      res.json({ data: service.update(actor(req), id, input) });
    },

    // ---- Vistas HTML ----
    htmlList(req, res) {
      const query = parseWith(listQuerySchema, req.query);
      const { data, meta } = service.list(query, opts(req));
      const params = new URLSearchParams();
      if (query.q) params.set('q', query.q);
      if (query.status !== 'all') params.set('status', query.status);
      if (query.position !== 'all') params.set('position', query.position);
      const qs = params.toString();
      res.render('pages/team/index', {
        title: 'Equipo',
        members: data,
        meta,
        query,
        positions: POSITIONS,
        canWrite: isPrivileged(req),
        baseUrl: `/team${qs ? `?${qs}` : ''}`,
        minutesToHours,
        centsToPesos,
      });
    },
    htmlNew: (_req, res) =>
      formView(res, {
        member: { position: 'backend', seniority: 'mid', weeklyHours: '40', hourlyCost: '0.00' },
        editing: false,
        canWrite: true,
      }),
    htmlEdit(req, res) {
      const member = service.get(parseId(req.params.id), opts(req));
      formView(res, {
        member: {
          ...member,
          weeklyHours: minutesToHours(member.weeklyCapacityMinutes),
          hourlyCost: centsToPesos(member.hourlyCostCents),
        },
        editing: true,
        canWrite: isPrivileged(req),
      });
    },
    htmlCreate(req, res) {
      const view = { member: { ...req.body }, editing: false, canWrite: true };
      return withForm(res, view, async () => {
        service.create(actor(req), parseWith(createMemberSchema, formToInput(req.body)));
        res.redirect('/team');
      });
    },
    htmlUpdate(req, res) {
      const id = parseId(req.params.id);
      service.get(id); // 404 si no existe
      const view = {
        member: { ...req.body, id, isActive: req.body.isActive === '1' },
        editing: true,
        canWrite: true,
      };
      return withForm(res, view, async () => {
        const input = { ...formToInput(req.body), isActive: req.body.isActive === '1' };
        service.update(actor(req), id, parseWith(updateMemberSchema, input));
        res.redirect('/team');
      });
    },
  };
}
