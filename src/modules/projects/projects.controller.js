import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  createAssignmentSchema,
  idSchema as assignmentIdSchema,
  updateAssignmentSchema,
} from '../assignments/assignments.schemas.js';
import {
  MILESTONE_STATUSES,
  createMilestoneSchema,
  milestoneIdSchema,
  milestoneStatusSchema,
  updateMilestoneSchema,
} from './milestones.schemas.js';
import {
  METHODOLOGIES,
  PRIORITIES,
  STATUSES,
  changeStatusSchema,
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

const parseMilestoneId = (raw) => {
  const parsed = milestoneIdSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Hito no encontrado');
  return parsed.data;
};

const parseAssignmentId = (raw) => {
  const parsed = assignmentIdSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Asignación no encontrada');
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

export function createProjectsController({ service, milestones, assignments }) {
  const actor = (req) => req.session.userId;

  const formView = (
    res,
    {
      status = 200,
      project,
      error = null,
      editing,
      canWrite,
      statusError = null,
      milestoneList = [],
      milestoneError = null,
      summary = null,
      assignmentList = [],
      assignmentError = null,
      warning = null,
    },
  ) =>
    res.status(status).render('pages/projects/form', {
      title: editing ? (canWrite ? 'Editar proyecto' : 'Ficha del proyecto') : 'Nuevo proyecto',
      project,
      error,
      editing,
      canWrite,
      statusError,
      milestones: milestoneList,
      milestoneError,
      summary,
      assignments: assignmentList,
      assignmentError,
      warning,
      milestoneStatuses: MILESTONE_STATUSES,
      transitions: editing ? service.allowedTransitions(project.status) : [],
      options: service.options(),
      priorities: PRIORITIES,
      methodologies: METHODOLOGIES,
    });

  /** Ficha del proyecto (formulario de edición + transiciones de estado). */
  function fichaView(
    req,
    res,
    id,
    { status = 200, error = null, milestoneError = null, assignmentError = null } = {},
  ) {
    const project = service.get(id);
    formView(res, {
      status,
      project: {
        ...project,
        budgetHours: minutesToHours(project.budgetMinutes),
        budgetAmount: centsToPesos(project.budgetCents),
        isBillable: project.isBillable ? '1' : '0',
      },
      editing: true,
      canWrite: canWriteRole(req),
      statusError: error,
      milestoneList: milestones.list(id),
      milestoneError,
      summary: service.summary(id),
      assignmentList: assignments.list(id),
      assignmentError,
      warning: req.query.warning === 'over-allocation' ? 'over-allocation' : null,
    });
  }

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
      fichaView(req, res, parseId(req.params.id));
    },
    // ---- Asignaciones (RF-40, RF-41) ----
    apiAssignmentsList: (req, res) => res.json({ data: assignments.list(parseId(req.params.id)) }),
    apiAssignmentCreate(req, res) {
      const input = parseWith(createAssignmentSchema, req.body);
      res.status(201).json(assignments.create(actor(req), parseId(req.params.id), input));
    },
    apiAssignmentUpdate(req, res) {
      const input = parseWith(updateAssignmentSchema, req.body);
      const id = parseAssignmentId(req.params.aId);
      res.json(assignments.update(actor(req), parseId(req.params.id), id, input));
    },
    apiAssignmentRemove(req, res) {
      assignments.remove(actor(req), parseId(req.params.id), parseAssignmentId(req.params.aId));
      res.status(204).end();
    },
    htmlAssignmentCreate(req, res) {
      const id = parseId(req.params.id);
      try {
        const b = req.body;
        const input = parseWith(createAssignmentSchema, {
          teamMemberId: Number(b.teamMemberId),
          projectRole: b.projectRole,
          allocationPercent: Number(b.allocationPercent),
          startDate: b.startDate,
          endDate: b.endDate,
        });
        const { warnings } = assignments.create(actor(req), id, input);
        const flag = warnings.length > 0 ? '?warning=over-allocation' : '';
        return res.redirect(`/projects/${id}${flag}`);
      } catch (err) {
        if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
        return fichaView(req, res, id, {
          status: err.status,
          assignmentError: err.details?.[0]?.message ?? err.message,
        });
      }
    },
    htmlAssignmentRemove(req, res) {
      const id = parseId(req.params.id);
      assignments.remove(actor(req), id, parseAssignmentId(req.params.aId));
      res.redirect(`/projects/${id}`);
    },

    // ---- Hitos (RF-32) ----
    apiMilestonesList: (req, res) => res.json({ data: milestones.list(parseId(req.params.id)) }),
    apiMilestoneCreate(req, res) {
      const input = parseWith(createMilestoneSchema, req.body);
      res.status(201).json({ data: milestones.create(actor(req), parseId(req.params.id), input) });
    },
    apiMilestoneUpdate(req, res) {
      const input = parseWith(updateMilestoneSchema, req.body);
      const data = milestones.update(
        actor(req),
        parseId(req.params.id),
        parseMilestoneId(req.params.msId),
        input,
      );
      res.json({ data });
    },
    apiMilestoneRemove(req, res) {
      milestones.remove(actor(req), parseId(req.params.id), parseMilestoneId(req.params.msId));
      res.status(204).end();
    },
    htmlMilestoneCreate(req, res) {
      const id = parseId(req.params.id);
      try {
        milestones.create(actor(req), id, parseWith(createMilestoneSchema, req.body));
        return res.redirect(`/projects/${id}`);
      } catch (err) {
        if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
        return fichaView(req, res, id, {
          status: err.status,
          milestoneError: err.details?.[0]?.message ?? err.message,
        });
      }
    },
    htmlMilestoneStatus(req, res) {
      const id = parseId(req.params.id);
      const { status } = parseWith(milestoneStatusSchema, { status: req.body.status });
      milestones.update(actor(req), id, parseMilestoneId(req.params.msId), { status });
      res.redirect(`/projects/${id}`);
    },
    htmlMilestoneRemove(req, res) {
      const id = parseId(req.params.id);
      milestones.remove(actor(req), id, parseMilestoneId(req.params.msId));
      res.redirect(`/projects/${id}`);
    },

    apiSummary: (req, res) => res.json({ data: service.summary(parseId(req.params.id)) }),
    apiChangeStatus(req, res) {
      const id = parseId(req.params.id);
      const input = parseWith(changeStatusSchema, req.body);
      res.json({ data: service.changeStatus(actor(req), id, input) });
    },
    htmlChangeStatus(req, res) {
      const id = parseId(req.params.id);
      try {
        const input = parseWith(changeStatusSchema, {
          status: req.body.status,
          confirmOpenTasks: req.body.confirmOpenTasks === '1',
        });
        service.changeStatus(actor(req), id, input);
        return res.redirect(`/projects/${id}`);
      } catch (err) {
        if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
        return fichaView(req, res, id, {
          status: err.status,
          error: err.details?.[0]?.message ?? err.message,
        });
      }
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
