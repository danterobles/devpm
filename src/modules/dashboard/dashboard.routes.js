import { Router } from 'express';
import { parseWith } from '../../lib/parse.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { filtersSchema } from './dashboard.schemas.js';
import { createKpiRepository } from './kpi.repository.js';
import { createKpiService } from './kpi.service.js';

/** Tablero de KPIs: lectura para todo usuario autenticado; el ingreso estimado (K14) solo admin y pm. */
export function createDashboardRouter({ db, timezone, getThresholds }) {
  const service = createKpiService({
    repository: createKpiRepository(db),
    timezone,
    getThresholds,
  });

  const router = Router();
  router.use(['/api/v1/dashboard'], requireAuth);
  router.get('/api/v1/dashboard/kpis', (req, res) => {
    const filters = parseWith(filtersSchema, req.query);
    const includeRevenue = ['admin', 'pm'].includes(req.session.role);
    res.json({ data: service.getAll(filters, { includeRevenue }) });
  });
  return router;
}
