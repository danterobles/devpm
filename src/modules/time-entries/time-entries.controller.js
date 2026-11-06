import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  createEntrySchema,
  idSchema,
  listQuerySchema,
  updateEntrySchema,
} from './time-entries.schemas.js';

const parseId = (raw) => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Registro de tiempo no encontrado');
  return parsed.data;
};

export function createTimeEntriesController({ service }) {
  const actor = (req) => ({ id: req.session.userId, role: req.session.role });

  return {
    apiList: (req, res) =>
      res.json(service.list(actor(req), parseWith(listQuerySchema, req.query))),
    apiGet: (req, res) => res.json({ data: service.get(actor(req), parseId(req.params.id)) }),
    apiCreate(req, res) {
      const input = parseWith(createEntrySchema, req.body);
      res.status(201).json({ data: service.create(actor(req), input) });
    },
    apiUpdate(req, res) {
      const input = parseWith(updateEntrySchema, req.body);
      res.json({ data: service.update(actor(req), parseId(req.params.id), input) });
    },
    apiRemove(req, res) {
      service.remove(actor(req), parseId(req.params.id));
      res.status(204).end();
    },
  };
}
