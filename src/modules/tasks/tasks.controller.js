import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  addDependencySchema,
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

const STATUS_LABELS = {
  backlog: 'Backlog',
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  blocked: 'Bloqueada',
  done: 'Hecha',
};
const BOARD_STATUS_LIST = Object.keys(STATUS_LABELS);

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

const toNumberOrNull = (v) => (v === undefined || v === '' ? null : Number(v));
const textOrNull = (v) => (v === undefined || v === '' ? null : v);

/** Formulario completo de edición de tarea → contrato de la API (los vacíos se vuelven null). */
function editFormToInput(body) {
  const hours = textOrNull(body.estimatedHours);
  if (hours !== null && !DECIMAL.test(String(hours).trim())) {
    throw AppError.validation('Datos inválidos', [
      { field: 'estimatedHours', message: 'Estimación en horas inválida' },
    ]);
  }
  const input = {
    title: body.title,
    description: textOrNull(body.description),
    type: body.type,
    priority: body.priority,
    storyPoints: toNumberOrNull(body.storyPoints),
    estimatedMinutes: hours === null ? null : Math.round(Number(hours) * 60),
    startDate: textOrNull(body.startDate),
    dueDate: textOrNull(body.dueDate),
    assigneeId: toNumberOrNull(body.assigneeId),
    milestoneId: toNumberOrNull(body.milestoneId),
  };
  // Las subtareas siguen el sprint del padre: su selector no se envía.
  if (body.sprintId !== undefined) input.sprintId = toNumberOrNull(body.sprintId);
  return input;
}

export function createTasksController({ service }) {
  const actorId = (req) => req.session.userId;
  const actor = (req) => ({ id: req.session.userId, role: req.session.role });
  const projectId = (req) => parseId(req.params.id, 'Proyecto no encontrado');
  const canWriteRole = (req) => ['admin', 'pm'].includes(req.session.role);

  /** Tablero del sprint indicado en la URL; 404 si el sprint no es del proyecto. */
  function boardOf(req) {
    const board = service.board(parseId(req.params.sid, 'Sprint no encontrado'));
    if (board.sprint.projectId !== projectId(req)) throw AppError.notFound('Sprint no encontrado');
    return board;
  }

  /** Página de una tarea: datos, estado, historial, subtareas y dependencias. */
  function taskPage(req, res, id, { status = 200, error = null, form = null } = {}) {
    const task = service.get(id);
    const canMove = service.canMove(actor(req));
    const parent = task.parentTaskId ? service.get(task.parentTaskId) : null;
    res.status(status).render('pages/tasks/show', {
      title: task.title,
      task: form ? { ...task, ...form } : task,
      parent,
      history: service.history(id),
      subtasks: service.subtasks(id),
      dependencies: service.dependencies(id),
      options: service.taskOptions(task.projectId, id),
      canWrite: canWriteRole(req),
      canMoveTask: canMove(task),
      error,
      types: TYPES,
      priorities: PRIORITIES,
      points: POINTS,
      statuses: BOARD_STATUS_LIST,
      statusLabels: STATUS_LABELS,
      hours: task.estimatedMinutes === null ? '' : String(task.estimatedMinutes / 60),
    });
  }
  /** Ejecuta la acción de la página; ante un error de regla vuelve a mostrarla con el mensaje. */
  const taskAction = (handler) => (req, res) => {
    try {
      return handler(req, res);
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
      return taskPage(req, res, parseId(req.params.id), {
        status: err.status,
        error: err.details?.[0]?.message ?? err.message,
        form: req.route.path.endsWith('/:id') ? req.body : null,
      });
    }
  };

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
    apiBoard: (req, res) =>
      res.json({ data: service.board(parseId(req.params.id, 'Sprint no encontrado')) }),
    apiDependencies: (req, res) => res.json({ data: service.dependencies(parseId(req.params.id)) }),
    apiAddDependency(req, res) {
      const { dependsOnTaskId } = parseWith(addDependencySchema, req.body);
      const data = service.addDependency(actorId(req), parseId(req.params.id), dependsOnTaskId);
      res.status(201).json({ data });
    },
    apiRemoveDependency(req, res) {
      const dependsOn = parseId(req.params.depId, 'Dependencia no encontrada');
      service.removeDependency(actorId(req), parseId(req.params.id), dependsOn);
      res.status(204).end();
    },
    apiReorder(req, res) {
      const { taskIds } = parseWith(reorderSchema, req.body);
      res.json({ data: service.reorder(actorId(req), projectId(req), taskIds) });
    },
    apiRemove(req, res) {
      service.remove(actorId(req), parseId(req.params.id));
      res.status(204).end();
    },

    // ---- Vistas HTML: página de la tarea ----
    htmlTask: (req, res) => taskPage(req, res, parseId(req.params.id)),
    htmlTaskUpdate: taskAction((req, res) => {
      const id = parseId(req.params.id);
      service.update(actorId(req), id, parseWith(updateTaskSchema, editFormToInput(req.body)));
      res.redirect(`/tasks/${id}`);
    }),
    htmlTaskStatus: taskAction((req, res) => {
      const id = parseId(req.params.id);
      const { status } = parseWith(changeStatusSchema, { status: req.body.status });
      service.changeStatus(actor(req), id, status);
      res.redirect(`/tasks/${id}`);
    }),
    htmlSubtaskCreate: taskAction((req, res) => {
      const id = parseId(req.params.id);
      const parent = service.get(id);
      const input = parseWith(createTaskSchema, { ...formToInput(req.body), parentTaskId: id });
      service.create(actorId(req), parent.projectId, input);
      res.redirect(`/tasks/${id}`);
    }),
    htmlDependencyAdd: taskAction((req, res) => {
      const id = parseId(req.params.id);
      const { dependsOnTaskId } = parseWith(addDependencySchema, {
        dependsOnTaskId: Number(req.body.dependsOnTaskId),
      });
      service.addDependency(actorId(req), id, dependsOnTaskId);
      res.redirect(`/tasks/${id}`);
    }),
    htmlDependencyRemove: taskAction((req, res) => {
      const id = parseId(req.params.id);
      service.removeDependency(
        actorId(req),
        id,
        parseId(req.params.depId, 'Dependencia no encontrada'),
      );
      res.redirect(`/tasks/${id}`);
    }),
    htmlTaskDelete: taskAction((req, res) => {
      const task = service.get(parseId(req.params.id));
      service.remove(actorId(req), task.id);
      res.redirect(`/projects/${task.projectId}/backlog`);
    }),

    // ---- Vistas HTML: tablero Kanban (RF-63) ----
    htmlBoard(req, res) {
      const board = boardOf(req);
      const canMove = service.canMove(actor(req));
      res.render('pages/tasks/board', {
        title: `Tablero · ${board.sprint.name}`,
        project: service.formOptions(board.sprint.projectId).project,
        ...board,
        canMove,
        statusLabels: STATUS_LABELS,
        statuses: BOARD_STATUS_LIST,
      });
    },
    htmlBoardStatus(req, res) {
      const board = boardOf(req);
      const { status } = parseWith(changeStatusSchema, { status: req.body.status });
      service.changeStatus(actor(req), parseId(req.params.taskId), status);
      res.redirect(`/projects/${board.sprint.projectId}/sprints/${board.sprint.id}/board`);
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
