import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  changeStatusSchema,
  createTaskSchema,
  idSchema,
  listQuerySchema,
  moveSchema,
  reorderSchema,
  updateTaskSchema,
  POINTS,
  PRIORITIES,
  TYPES,
} from './tasks.schemas.js';

const parseId = (raw, message = 'Tarea no encontrada') => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound(message);
  return parsed.data;
};

const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** Mapea el formulario de alta rápida (backlog) al contrato de la API. */
function formToInput(body) {
  const input = {};
  for (const key of ['title', 'description', 'type', 'priority']) {
    if (body[key] !== undefined && body[key] !== '') input[key] = body[key];
  }
  if (body.storyPoints !== undefined && body.storyPoints !== '')
    input.storyPoints = Number(body.storyPoints);
  if (body.assigneeId !== undefined && body.assigneeId !== '')
    input.assigneeId = Number(body.assigneeId);
  if (body.estimatedHours !== undefined && body.estimatedHours !== '') {
    if (!DECIMAL.test(String(body.estimatedHours).trim())) {
      throw AppError.validation('Datos inválidos', [
        { field: 'estimatedHours', message: 'Estimación en horas inválida' },
      ]);
    }
    input.estimatedMinutes = Math.round(Number(body.estimatedHours) * 60);
  }
  if (body.title === '') input.title = '';
  return input;
}

export function createTasksController({ service }) {
  const actorId = (req) => req.session.userId;
  const actor = (req) => ({ id: req.session.userId, role: req.session.role });
  const projectId = (req) => parseId(req.params.id, 'Proyecto no encontrado');
  const canWriteRole = (req) => ['admin', 'pm'].includes(req.session.role);

  function backlogPage(req, res, pid, { status = 200, error = null, form = {} } = {}) {
    res.status(status).render('pages/tasks/backlog', {
      title: 'Backlog',
      ...service.formOptions(pid),
      tasks: service.backlog(pid),
      canWrite: canWriteRole(req),
      error,
      form,
      types: TYPES,
      priorities: PRIORITIES,
      points: POINTS,
    });
  }
  function backlogError(req, res, pid, err) {
    if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
    return backlogPage(req, res, pid, {
      status: err.status,
      error: err.details?.[0]?.message ?? err.message,
      form: req.body,
    });
  }

  return {
    apiList: (req, res) =>
      res.json(service.list(projectId(req), parseWith(listQuerySchema, req.query))),
    apiCreate(req, res) {
      const input = parseWith(createTaskSchema, req.body);
      res.status(201).json({ data: service.create(actorId(req), projectId(req), input) });
    },
    apiGet: (req, res) => res.json({ data: service.get(parseId(req.params.id)) }),
    apiHistory: (req, res) => res.json({ data: service.history(parseId(req.params.id)) }),
    apiUpdate(req, res) {
      const input = parseWith(updateTaskSchema, req.body);
      res.json({ data: service.update(actorId(req), parseId(req.params.id), input) });
    },
    apiChangeStatus(req, res) {
      const { status } = parseWith(changeStatusSchema, req.body);
      res.json({ data: service.changeStatus(actor(req), parseId(req.params.id), status) });
    },
    apiReorder(req, res) {
      const { taskIds } = parseWith(reorderSchema, req.body);
      res.json({ data: service.reorder(actorId(req), projectId(req), taskIds) });
    },
    apiRemove(req, res) {
      service.remove(actorId(req), parseId(req.params.id));
      res.status(204).end();
    },

    // ---- Vistas HTML: backlog (RF-63) ----
    htmlBacklog: (req, res) => backlogPage(req, res, projectId(req)),
    htmlBacklogCreate(req, res) {
      const pid = projectId(req);
      try {
        service.create(actorId(req), pid, parseWith(createTaskSchema, formToInput(req.body)));
        return res.redirect(`/projects/${pid}/backlog`);
      } catch (err) {
        return backlogError(req, res, pid, err);
      }
    },
    htmlBacklogMove(req, res) {
      const pid = projectId(req);
      const { direction } = parseWith(moveSchema, { direction: req.body.direction });
      service.moveInBacklog(actorId(req), pid, parseId(req.params.taskId), direction);
      res.redirect(`/projects/${pid}/backlog`);
    },
    htmlBacklogSprint(req, res) {
      const pid = projectId(req);
      try {
        const sprintId = req.body.sprintId ? Number(req.body.sprintId) : null;
        service.update(actorId(req), parseId(req.params.taskId), { sprintId });
        return res.redirect(`/projects/${pid}/backlog`);
      } catch (err) {
        return backlogError(req, res, pid, err);
      }
    },
  };
}
