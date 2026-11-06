import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  changeStatusSchema,
  createTaskSchema,
  idSchema,
  listQuerySchema,
  updateTaskSchema,
} from './tasks.schemas.js';

const parseId = (raw, message = 'Tarea no encontrada') => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound(message);
  return parsed.data;
};

export function createTasksController({ service }) {
  const actorId = (req) => req.session.userId;
  const actor = (req) => ({ id: req.session.userId, role: req.session.role });
  const projectId = (req) => parseId(req.params.id, 'Proyecto no encontrado');

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
    apiRemove(req, res) {
      service.remove(actorId(req), parseId(req.params.id));
      res.status(204).end();
    },
  };
}
