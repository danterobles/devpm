import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  closeSprintSchema,
  createSprintSchema,
  idSchema,
  updateSprintSchema,
} from './sprints.schemas.js';

const parseId = (raw, message = 'Sprint no encontrado') => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound(message);
  return parsed.data;
};
const canWriteRole = (req) => ['admin', 'pm'].includes(req.session.role);

export function createSprintsController({ service }) {
  const actor = (req) => req.session.userId;
  const projectId = (req) => parseId(req.params.id, 'Proyecto no encontrado');

  function page(req, res, pid, { status = 200, error = null } = {}) {
    res.status(status).render('pages/sprints/index', {
      title: 'Sprints',
      project: service.getProject(pid),
      sprints: service.list(pid),
      canWrite: canWriteRole(req),
      error,
    });
  }
  const guarded = (handler) => (req, res) => {
    try {
      return handler(req, res);
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
      return page(req, res, projectId(req), {
        status: err.status,
        error: err.details?.[0]?.message ?? err.message,
      });
    }
  };

  return {
    // ---- API JSON ----
    apiList: (req, res) => res.json({ data: service.list(projectId(req)) }),
    apiCreate(req, res) {
      const input = parseWith(createSprintSchema, req.body);
      res.status(201).json({ data: service.create(actor(req), projectId(req), input) });
    },
    apiGet: (req, res) => res.json({ data: service.get(parseId(req.params.id)) }),
    apiUpdate(req, res) {
      const input = parseWith(updateSprintSchema, req.body);
      res.json({ data: service.update(actor(req), parseId(req.params.id), input) });
    },
    apiStart: (req, res) => res.json({ data: service.start(actor(req), parseId(req.params.id)) }),
    apiClose(req, res) {
      const input = parseWith(closeSprintSchema, req.body ?? {});
      res.json({ data: service.close(actor(req), parseId(req.params.id), input) });
    },
    apiRemove(req, res) {
      service.remove(actor(req), parseId(req.params.id));
      res.status(204).end();
    },

    // ---- Vistas HTML ----
    htmlIndex: (req, res) => page(req, res, projectId(req)),
    htmlCreate: guarded((req, res) => {
      const pid = projectId(req);
      service.create(actor(req), pid, parseWith(createSprintSchema, req.body));
      res.redirect(`/projects/${pid}/sprints`);
    }),
    htmlStart: guarded((req, res) => {
      service.start(actor(req), parseId(req.params.sid));
      res.redirect(`/projects/${projectId(req)}/sprints`);
    }),
    htmlClose: guarded((req, res) => {
      const moveTo = req.body.moveTo ? Number(req.body.moveTo) : null;
      service.close(actor(req), parseId(req.params.sid), parseWith(closeSprintSchema, { moveTo }));
      res.redirect(`/projects/${projectId(req)}/sprints`);
    }),
    htmlRemove: guarded((req, res) => {
      service.remove(actor(req), parseId(req.params.sid));
      res.redirect(`/projects/${projectId(req)}/sprints`);
    }),
  };
}
