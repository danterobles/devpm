import { Router } from 'express';
import { z } from 'zod';
import { parseWith } from '../../lib/parse.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { EVENT_TYPES } from '../security-events/security-events.service.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
const emptyToUndefined = (v) => (v === '' ? undefined : v);
const opt = (schema) => z.preprocess(emptyToUndefined, schema.optional());

const auditQuery = z.object({
  ...page,
  entity: opt(z.string().max(40)),
  action: opt(z.enum(['create', 'update', 'delete', 'status_change'])),
  userId: opt(z.coerce.number().int().positive()),
  from: opt(date),
  to: opt(date),
});
const securityQuery = z.object({
  ...page,
  type: opt(z.enum(Object.keys(EVENT_TYPES))),
  q: opt(z.string().trim().max(100)),
  from: opt(date),
  to: opt(date),
});

/** Bitácora, eventos de seguridad y estado del sistema: solo `admin`. */
export function createAdminToolsRouter({ audit, securityEvents, status }) {
  const admin = requireRole('admin');
  const router = Router();

  router.get('/api/v1/audit', admin, (req, res) =>
    res.json(audit.list(parseWith(auditQuery, req.query))),
  );
  router.get('/admin/audit', admin, (req, res) => {
    const filters = parseWith(auditQuery, req.query);
    const result = audit.list(filters);
    res.render('pages/admin/audit/index', {
      title: 'Bitácora',
      items: result.data,
      meta: result.meta,
      filters,
      options: audit.options(),
      query: new URLSearchParams(
        Object.entries(filters)
          .filter(([k, v]) => v !== undefined && !['page', 'pageSize'].includes(k))
          .map(([k, v]) => [k, String(v)]),
      ).toString(),
    });
  });

  router.get('/api/v1/security-events', admin, (req, res) =>
    res.json(securityEvents.list(parseWith(securityQuery, req.query))),
  );
  router.get('/admin/security', admin, (req, res) => {
    const filters = parseWith(securityQuery, req.query);
    const result = securityEvents.list(filters);
    res.render('pages/admin/security/index', {
      title: 'Seguridad',
      items: result.data,
      meta: result.meta,
      filters,
      types: EVENT_TYPES,
      query: new URLSearchParams(
        Object.entries(filters)
          .filter(([k, v]) => v !== undefined && !['page', 'pageSize'].includes(k))
          .map(([k, v]) => [k, String(v)]),
      ).toString(),
    });
  });

  router.get('/api/v1/status', admin, (_req, res) => res.json({ data: status.snapshot() }));
  router.get('/admin/status', admin, (_req, res) =>
    res.render('pages/admin/status/index', { title: 'Estado del sistema', s: status.snapshot() }),
  );
  return router;
}
