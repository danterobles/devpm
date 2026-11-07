import { Router } from 'express';
import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { DEFAULT_THRESHOLDS } from '../dashboard/thresholds.js';
import { thresholdsSchema } from './thresholds.schemas.js';

// Cómo se muestra cada umbral en la página de configuración.
export const KPI_FORM = [
  {
    id: 'k3',
    title: 'K3 · SPI (calendario)',
    hint: 'Verde si ≥ verde; ámbar si ≥ ámbar; rojo por debajo.',
    fields: [
      ['green', 'Verde desde'],
      ['amber', 'Ámbar desde'],
    ],
  },
  {
    id: 'k4',
    title: 'K4 · CPI (costo en horas)',
    hint: 'Verde si ≥ verde; ámbar si ≥ ámbar; rojo por debajo.',
    fields: [
      ['green', 'Verde desde'],
      ['amber', 'Ámbar desde'],
    ],
  },
  {
    id: 'k5',
    title: 'K5 · Consumo de presupuesto',
    hint: 'Margen (puntos porcentuales) sobre el avance.',
    fields: [
      ['greenMargin', 'Verde hasta avance +'],
      ['amberMargin', 'Ámbar hasta avance +'],
    ],
  },
  {
    id: 'k6',
    title: 'K6 · Utilización del equipo (%)',
    hint: 'Banda verde dentro de la banda ámbar; fuera, rojo.',
    fields: [
      ['greenMin', 'Verde mínimo'],
      ['greenMax', 'Verde máximo'],
      ['amberMin', 'Ámbar mínimo'],
      ['amberMax', 'Ámbar máximo'],
    ],
  },
  {
    id: 'k7',
    title: 'K7 · Miembros sobreasignados',
    hint: 'Cantidad máxima para cada color.',
    fields: [
      ['greenMax', 'Verde hasta'],
      ['amberMax', 'Ámbar hasta'],
    ],
  },
  {
    id: 'k9',
    title: 'K9 · Cumplimiento de compromiso (%)',
    hint: 'Verde si ≥ verde; ámbar si ≥ ámbar.',
    fields: [
      ['green', 'Verde desde'],
      ['amber', 'Ámbar desde'],
    ],
  },
  {
    id: 'k10',
    title: 'K10 · Tareas vencidas',
    hint: 'Cantidad máxima para cada color.',
    fields: [
      ['greenMax', 'Verde hasta'],
      ['amberMax', 'Ámbar hasta'],
    ],
  },
  {
    id: 'k11',
    title: 'K11 · Tareas bloqueadas',
    hint: 'Cantidad máxima para cada color.',
    fields: [
      ['greenMax', 'Verde hasta'],
      ['amberMax', 'Ámbar hasta'],
    ],
  },
  {
    id: 'k15',
    title: 'K15 · Hitos vencidos',
    hint: 'Cantidad máxima para cada color.',
    fields: [
      ['greenMax', 'Verde hasta'],
      ['amberMax', 'Ámbar hasta'],
    ],
  },
  {
    id: 'k16',
    title: 'K16 · Registro de horas de la semana (%)',
    hint: 'Verde si ≥ verde; ámbar si ≥ ámbar.',
    fields: [
      ['green', 'Verde desde'],
      ['amber', 'Ámbar desde'],
    ],
  },
];

/** Formulario plano (`k3.green`, …) → objeto de umbrales; lo vacío o no numérico queda como NaN. */
function fromForm(body) {
  const out = {};
  for (const [kpi, fields] of Object.entries(DEFAULT_THRESHOLDS)) {
    out[kpi] = {};
    for (const key of Object.keys(fields)) {
      const raw = String(body[`${kpi}.${key}`] ?? '').trim();
      out[kpi][key] = raw === '' ? Number.NaN : Number(raw);
    }
  }
  return out;
}

/** Configuración de la aplicación: lectura para todo usuario autenticado; escritura solo `admin`. */
export function createSettingsRouter({ settings }) {
  const adminOnly = requireRole('admin');
  const router = Router();
  router.use(['/api/v1/settings', '/admin/settings'], requireAuth);

  // ---- API ----
  router.get('/api/v1/settings/kpi-thresholds', (_req, res) =>
    res.json({ data: settings.describe() }),
  );
  router.put('/api/v1/settings/kpi-thresholds', adminOnly, (req, res) => {
    const input = parseWith(thresholdsSchema, req.body);
    res.json({ data: settings.update(req.session.userId, input) });
  });
  router.delete('/api/v1/settings/kpi-thresholds', adminOnly, (req, res) => {
    res.json({ data: settings.reset(req.session.userId) });
  });

  // ---- Vista ----
  const page = (req, res, { status = 200, values, error = null } = {}) => {
    const current = settings.describe();
    res.status(status).render('pages/settings/kpis', {
      title: 'Umbrales de los KPIs',
      groups: KPI_FORM,
      values: values ?? current.thresholds,
      isDefault: current.isDefault,
      saved: req.query.saved === '1',
      error,
    });
  };
  router.get('/admin/settings/kpis', adminOnly, (req, res) => page(req, res));
  router.post('/admin/settings/kpis', adminOnly, (req, res) => {
    const input = fromForm(req.body);
    try {
      settings.update(req.session.userId, parseWith(thresholdsSchema, input));
      return res.redirect('/admin/settings/kpis?saved=1');
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      // Conserva lo escrito (los NaN se muestran vacíos) y explica el motivo.
      return page(req, res, {
        status: err.status,
        values: input,
        error: err.details?.[0]?.message ?? err.message,
      });
    }
  });
  router.post('/admin/settings/kpis/reset', adminOnly, (req, res) => {
    settings.reset(req.session.userId);
    res.redirect('/admin/settings/kpis?saved=1');
  });
  return router;
}
