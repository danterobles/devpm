import { Router } from 'express';
import { parseWith } from '../../lib/parse.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { rangeQuerySchema } from './load.schemas.js';
import { createLoadService } from './load.service.js';

/** Carga semanal (RF-23) y matriz de asignaciones (RF-43): lectura para todo usuario autenticado. */
export function createLoadRouter({ db, timezone }) {
  const service = createLoadService({ db, timezone });
  const query = (req) => parseWith(rangeQuerySchema, req.query);

  const api = Router();
  api.use(requireAuth);
  api.get('/load', (req, res) => res.json({ data: service.load(query(req)) }));
  api.get('/matrix', (req, res) => res.json({ data: service.matrix(query(req)) }));

  const html = Router();
  html.use(requireAuth);
  html.get('/load', (req, res) => {
    const data = service.load(query(req));
    res.render('pages/assignments/load', { title: 'Carga del equipo', ...data });
  });
  html.get('/matrix', (req, res) => {
    const data = service.matrix(query(req));
    res.render('pages/assignments/matrix', { title: 'Matriz de asignaciones', ...data });
  });

  const router = Router();
  router.use('/api/v1/assignments', api);
  router.use('/assignments', html);
  return router;
}
