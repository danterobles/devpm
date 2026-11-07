import { Router } from 'express';
import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { createSchema, idSchema, scopeQuerySchema } from './saved-filters.schemas.js';

/** A dónde vuelve cada ámbito tras guardar o eliminar (rutas fijas: nunca una dirección del cliente). */
const BACK = {
  projects: () => '/projects',
  time: () => '/time/approvals',
  tasks: (projectId) => `/projects/${projectId}/backlog`,
};

const textFields = (body) =>
  Object.fromEntries(Object.entries(body ?? {}).filter(([, v]) => typeof v === 'string'));

const parseId = (raw) => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Filtro no encontrado');
  return parsed.data;
};

/** Cada persona solo ve y modifica sus propios filtros (el repository acota por usuario). */
export function createSavedFiltersRouter({ service }) {
  const uid = (req) => req.session.userId;
  const router = Router();
  router.get('/api/v1/saved-filters', (req, res) => {
    const { scope } = parseWith(scopeQuerySchema, req.query);
    res.json({ data: service.list(uid(req), scope) });
  });
  router.post('/api/v1/saved-filters', (req, res) => {
    res.status(201).json({ data: service.create(uid(req), parseWith(createSchema, req.body)) });
  });
  router.delete('/api/v1/saved-filters/:id', (req, res) => {
    service.remove(uid(req), parseId(req.params.id));
    res.status(204).end();
  });

  // Formularios de las pantallas (Guardar filtro actual / Eliminar)
  const projectIdOf = (body) => {
    const id = Number(body?.projectId);
    return Number.isInteger(id) && id > 0 ? id : null;
  };
  router.post('/saved-filters', (req, res) => {
    const input = parseWith(createSchema, {
      scope: req.body?.scope,
      name: req.body?.name,
      // `query` (cadena) o, desde un formulario con los filtros como campos, esos mismos campos
      query: req.body?.query ?? textFields(req.body),
    });
    const projectId = projectIdOf(req.body);
    if (input.scope === 'tasks' && projectId === null)
      throw AppError.notFound('Proyecto no encontrado');
    const saved = service.create(uid(req), input);
    res.redirect(`${BACK[input.scope](projectId)}?${saved.query}`);
  });
  router.post('/saved-filters/:id/delete', (req, res) => {
    const filter = service.find(uid(req), parseId(req.params.id));
    service.remove(uid(req), filter.id);
    const projectId = projectIdOf(req.body);
    res.redirect(
      filter.scope === 'tasks' && projectId === null ? '/projects' : BACK[filter.scope](projectId),
    );
  });
  return router;
}
