import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { commentSchema, idSchema } from './comments.schemas.js';

const parseId = (raw, message) => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound(message);
  return parsed.data;
};
const taskId = (req) => parseId(req.params.id, 'Tarea no encontrada');
const commentId = (req) => parseId(req.params.id, 'Comentario no encontrado');
const actor = (req) => ({
  id: req.session.userId,
  role: req.session.role,
  fullName: req.session.fullName,
});

export function createCommentsController({ service, repository }) {
  const back = (res, task) => res.redirect(`/tasks/${task}#comentarios`);
  return {
    apiList: (req, res) => res.json({ data: service.list(taskId(req)) }),
    apiCreate: (req, res) =>
      res.status(201).json({
        data: service.create(actor(req), taskId(req), parseWith(commentSchema, req.body)),
      }),
    apiUpdate: (req, res) =>
      res.json({
        data: service.update(actor(req), commentId(req), parseWith(commentSchema, req.body)),
      }),
    apiRemove: (req, res) => {
      service.remove(actor(req), commentId(req));
      res.status(204).end();
    },

    htmlCreate(req, res) {
      const id = taskId(req);
      service.create(actor(req), id, parseWith(commentSchema, { body: req.body?.body ?? '' }));
      back(res, id);
    },
    htmlUpdate(req, res) {
      const id = commentId(req);
      const updated = service.update(
        actor(req),
        id,
        parseWith(commentSchema, { body: req.body?.body ?? '' }),
      );
      back(res, updated.taskId);
    },
    htmlRemove(req, res) {
      const id = commentId(req);
      const task = repository.findById(id)?.task_id;
      service.remove(actor(req), id);
      back(res, task);
    },
  };
}
