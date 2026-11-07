import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { ENTITIES } from './import.entities.js';
import { createImportService, MAX_ROWS } from './import.service.js';

const entitySchema = z.enum(Object.keys(ENTITIES), { error: 'Entidad inválida' });
const bodySchema = z.object({
  entity: entitySchema,
  csv: z.string().max(1_000_000, 'El archivo supera 1 MB').default(''),
  projectId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  action: z.enum(['validate', 'import']).default('validate'),
});

/** Importación por CSV: solo `admin` y `pm` (los mismos que crean clientes, equipo y tareas). */
export function createImportRouter({ db, events, timezone }) {
  const service = createImportService({ db, events, timezone });
  const projects = db.prepare(
    "SELECT id, code, name FROM projects WHERE status IN ('planning','active','on_hold') ORDER BY code",
  );
  const guard = requireRole('admin', 'pm');

  const render = (res, extra = {}) =>
    res.render('pages/import/index', {
      title: 'Importar datos',
      entities: ENTITIES,
      maxRows: MAX_ROWS,
      projects: projects.all(),
      form: { entity: 'clients', csv: '', projectId: '' },
      result: null,
      done: null,
      error: null,
      ...extra,
    });

  const router = Router();
  router.get('/import', guard, (req, res) => {
    const done = Number(req.query.done);
    const entity = ENTITIES[req.query.entity] ? req.query.entity : null;
    render(res, {
      done: Number.isInteger(done) && done > 0 && entity ? { count: done, entity } : null,
    });
  });

  router.get('/import/template/:entity.csv', guard, (req, res) => {
    const entity = parseWith(entitySchema, req.params.entity);
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="plantilla-${entity}.csv"`)
      .send(service.template(entity));
  });

  router.post('/import', guard, (req, res) => {
    let input;
    try {
      input = parseWith(bodySchema, req.body ?? {});
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return render(res.status(err.status), { error: err.details?.[0]?.message ?? err.message });
    }
    const actor = { id: req.session.userId, role: req.session.role };
    const form = { entity: input.entity, csv: input.csv, projectId: input.projectId ?? '' };
    const options = { projectId: input.projectId };
    if (input.action === 'import') {
      const result = service.commit(actor, input.entity, input.csv, options);
      if (result.imported > 0)
        return res.redirect(`/import?done=${result.imported}&entity=${input.entity}`);
      return render(res.status(result.fatal ? 400 : 422), { form, result });
    }
    return render(res, { form, result: service.validate(actor, input.entity, input.csv, options) });
  });
  return router;
}
