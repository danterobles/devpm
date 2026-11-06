import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { createGanttRepository } from './gantt.repository.js';
import { createGanttService } from './gantt.service.js';

const querySchema = z.object({ groupBy: z.enum(['none', 'sprint']).default('none') });
const idSchema = z.coerce.number().int().positive();

/** Gantt: lectura para todo usuario autenticado; solo admin y pm pueden reprogramar. */
export function createGanttRouter({ db, timezone }) {
  const service = createGanttService({ repository: createGanttRepository(db), timezone });
  const canReschedule = (req) => ['admin', 'pm'].includes(req.session.role);
  const projectId = (req) => {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound('Proyecto no encontrado');
    return parsed.data;
  };

  const router = Router();
  router.use(['/api/v1/projects/:id/gantt', '/projects/:id/gantt'], requireAuth);
  router.get('/api/v1/projects/:id/gantt', (req, res) => {
    const { groupBy } = parseWith(querySchema, req.query);
    res.json({
      data: service.project(projectId(req), { groupBy, canReschedule: canReschedule(req) }),
    });
  });
  router.get('/projects/:id/gantt', (req, res) => {
    const data = service.project(projectId(req), { canReschedule: canReschedule(req) });
    res.render('pages/gantt/project', {
      title: `Gantt · ${data.project.code}`,
      project: data.project,
      canReschedule: data.canReschedule,
    });
  });
  return router;
}
