import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  METHODOLOGIES,
  PRIORITIES,
  STATUSES,
  createProjectSchema,
  idParamSchema,
  listQuerySchema,
  updateProjectSchema,
} from './projects.schemas.js';

const canWriteRole = (req) => ['admin', 'pm'].includes(req.session.role);

const parseId = (raw) => {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Proyecto no encontrado');
  return parsed.data;
};

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const isDecimal = (t) => DECIMAL.test(String(t ?? '').trim());
const hoursToMinutes = (t) => Math.round(Number(t) * 60);
const pesosToCents = (t) => Math.round(Number(t) * 100);
export const minutesToHours = (m) => (m === null || m === undefined ? '' : String(m / 60));
export const centsToPesos = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

/** Mapea el cuerpo del formulario al contrato de la API (mismos esquemas Zod). */
function formToInput(body) {
  const input = {};
  for (const key of ['name', 'description', 'priority', 'methodology', 'startDate', 'endDate']) {
    if (body[key] !== undefined) input[key] = body[key];
  }
  if (body.clientId !== undefined) input.clientId = Number(body.clientId);
  if (body.managerId !== undefined)
    input.managerId = body.managerId === '' ? null : Number(body.managerId);
  if (body.isBillable === '1') input.isBillable = true;
  if (body.isBillable === '0') input.isBillable = false;
  const details = [];
  if (!isDecimal(body.budgetHours)) {
    details.push({ field: 'budgetHours', message: 'Presupuesto de horas inválido' });
  } else {
    input.budgetMinutes = hoursToMinutes(body.budgetHours);
  }
  if (body.budgetAmount === undefined || body.budgetAmount === '') input.budgetCents = null;
  else if (!isDecimal(body.budgetAmount)) {
    details.push({ field: 'budgetAmount', message: 'Presupuesto monetario inválido' });
  } else input.budgetCents = pesosToCents(body.budgetAmount);
  if (details.length > 0) throw AppError.validation('Datos inválidos', details);
  return input;
}

export function createProjectsController({ service }) {
  const actor = (req) => req.session.userId;

  const formView = (res, { status = 200, project, error = null, editing, canWrite }) =>
    res.status(status).render('pages/projects/form', {
      title: editing ? (canWrite ? 'Editar proyecto' : 'Ficha del proyecto') : 'Nuevo proyecto',
      project,
      error,
      editing,
      canWrite,
      options: service.options(),
      priorities: PRIORITIES,
      methodologies: METHODOLOGIES,
    });

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
    apiList: (req, res) => res.json(service.list(parseWith(listQuerySchema, req.query))),
    apiGet: (req, res) => res.json({ data: service.get(parseId(req.params.id)) }),
    apiCreate(req, res) {
      const input = parseWith(createProjectSchema, req.body);
      res.status(201).json({ data: service.create(actor(req), input) });
    },
    apiUpdate(req, res) {
      const id = parseId(req.params.id);
      const input = parseWith(updateProjectSchema, req.body);
      res.json({ data: service.update(actor(req), id, input) });
    },

    // ---- Vistas HTML ----
    htmlList(req, res) {
      const query = parseWith(listQuerySchema, req.query);
      const { data, meta } = service.list(query);
      const params = new URLSearchParams();
      if (query.q) params.set('q', query.q);
      if (query.status !== 'all') params.set('status', query.status);
      if (query.priority !== 'all') params.set('priority', query.priority);
      const qs = params.toString();
      res.render('pages/projects/index', {
        title: 'Proyectos',
        projects: data,
        meta,
        query,
        statuses: STATUSES,
        priorities: PRIORITIES,
        canWrite: canWriteRole(req),
        baseUrl: `/projects${qs ? `?${qs}` : ''}`,
      });
    },
    htmlNew: (_req, res) =>
      formView(res, {
        project: { priority: 'medium', methodology: 'scrum', budgetHours: '0' },
        editing: false,
        canWrite: true,
      }),
    htmlEdit(req, res) {
      const project = service.get(parseId(req.params.id));
      formView(res, {
        project: {
          ...project,
          budgetHours: minutesToHours(project.budgetMinutes),
          budgetAmount: centsToPesos(project.budgetCents),
          isBillable: project.isBillable ? '1' : '0',
        },
        editing: true,
        canWrite: canWriteRole(req),
      });
    },
    htmlCreate(req, res) {
      const view = { project: { ...req.body }, editing: false, canWrite: true };
      return withForm(res, view, async () => {
        service.create(actor(req), parseWith(createProjectSchema, formToInput(req.body)));
        res.redirect('/projects');
      });
    },
    htmlUpdate(req, res) {
      const id = parseId(req.params.id);
      const current = service.get(id);
      const view = { project: { ...current, ...req.body, id }, editing: true, canWrite: true };
      return withForm(res, view, async () => {
        service.update(actor(req), id, parseWith(updateProjectSchema, formToInput(req.body)));
        res.redirect('/projects');
      });
    },
  };
}
