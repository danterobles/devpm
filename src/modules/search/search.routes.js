import { Router } from 'express';
import { z } from 'zod';
import { parseWith } from '../../lib/parse.js';
import { createSearchRepository } from './search.repository.js';
import { createSearchService, MIN_LENGTH } from './search.service.js';

const querySchema = z.object({ q: z.string().trim().max(100).default('') });

/** Búsqueda global: cualquier usuario autenticado (solo devuelve lo que ya ven los listados). */
export function createSearchRouter({ db }) {
  const service = createSearchService({ repository: createSearchRepository(db) });
  const router = Router();
  router.get('/api/v1/search', (req, res) => {
    const { q } = parseWith(querySchema, req.query);
    res.json({ data: service.search(q) });
  });
  router.get('/search', (req, res) => {
    const { q } = parseWith(querySchema, req.query);
    res.render('pages/search/index', {
      title: 'Búsqueda',
      result: service.search(q),
      minLength: MIN_LENGTH,
    });
  });
  return router;
}
