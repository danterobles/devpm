import { Router } from 'express';
import { parseWith } from '../../lib/parse.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { filtersSchema } from './dashboard.schemas.js';
import { createKpiRepository } from './kpi.repository.js';
import { createKpiService } from './kpi.service.js';

/** Tablero de KPIs: lectura para todo usuario autenticado; el ingreso estimado (K14) solo admin y pm. */
export function createDashboardRouter({ db, timezone, getThresholds }) {
  const repository = createKpiRepository(db);
  const service = createKpiService({ repository, timezone, getThresholds });

  const router = Router();
  router.use(['/api/v1/dashboard', '/dashboard'], requireAuth);
  router.get('/api/v1/dashboard/kpis', (req, res) => {
    const filters = parseWith(filtersSchema, req.query);
    const includeRevenue = ['admin', 'pm'].includes(req.session.role);
    res.json({ data: service.getAll(filters, { includeRevenue }) });
  });
  router.get('/dashboard', (req, res) => {
    // Los filtros inválidos no rompen la página: el script mostrará el error del API.
    const parsed = filtersSchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : {};
    res.render('pages/dashboard/index', {
      title: 'Tablero de KPIs',
      filters,
      options: repository.filterOptions(),
      canSeeRevenue: ['admin', 'pm'].includes(req.session.role),
      canConfigure: req.session.role === 'admin',
    });
  });
  return router;
}
