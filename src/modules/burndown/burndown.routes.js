import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { createBurndownService } from './burndown.service.js';

const idSchema = z.coerce.number().int().positive();
const querySchema = z.object({ metric: z.enum(['points', 'hours']).default('points') });

/** Burndown: lectura para todo usuario autenticado. */
export function createBurndownRouter({ db, timezone }) {
  const service = createBurndownService({ db, timezone });
  const sprintId = (req) => {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound('Sprint no encontrado');
    return parsed.data;
  };

  const router = Router();
  router.use(['/api/v1/sprints/:id/burndown', '/projects/:id/sprints/:sid/burndown'], requireAuth);
  router.get('/api/v1/sprints/:id/burndown', (req, res) => {
    const { metric } = parseWith(querySchema, req.query);
    res.json({ data: service.sprint(sprintId(req), { metric }) });
  });
  router.get('/projects/:id/sprints/:sid/burndown', (req, res) => {
    const projectId = idSchema.safeParse(req.params.id);
    const sprintParsed = idSchema.safeParse(req.params.sid);
    if (!projectId.success || !sprintParsed.success)
      throw AppError.notFound('Sprint no encontrado');
    const data = service.sprint(sprintParsed.data);
    if (data.sprint.projectId !== projectId.data) throw AppError.notFound('Sprint no encontrado');
    res.render('pages/burndown/sprint', {
      title: `Burndown · ${data.sprint.name}`,
      sprint: data.sprint,
      project: { id: projectId.data, code: service.projectCode(projectId.data) },
    });
  });
  return router;
}
