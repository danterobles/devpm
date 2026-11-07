import { Router } from 'express';
import { createHomeService } from './home.service.js';
import { createHomeRepository } from './home.repository.js';

/** Inicio «Mi día»: cualquier usuario autenticado ve el panel que corresponde a su rol. */
export function createHomeRouter({ db, notifications, kpi, timezone }) {
  const service = createHomeService({
    repository: createHomeRepository(db),
    notifications,
    kpi,
    timezone,
  });
  const router = Router();
  router.get('/', (req, res) => {
    const panel = service.forUser({ id: req.session.userId, role: req.session.role });
    res.render('pages/home-day', { title: 'Inicio', panel, fullName: req.session.fullName });
  });
  return router;
}
