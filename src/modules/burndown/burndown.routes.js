import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/AppError.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { createBurndownService } from './burndown.service.js';

const idSchema = z.coerce.number().int().positive();

/** Burndown: lectura para todo usuario autenticado. */
export function createBurndownRouter({ db, timezone }) {
  const service = createBurndownService({ db, timezone });
  const sprintId = (req) => {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound('Sprint no encontrado');
    return parsed.data;
  };

  const router = Router();
  router.use(['/api/v1/sprints/:id/burndown'], requireAuth);
  router.get('/api/v1/sprints/:id/burndown', (req, res) => {
    res.json({ data: service.sprint(sprintId(req)) });
  });
  return router;
}
