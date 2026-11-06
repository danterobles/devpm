import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import {
  createClientSchema,
  idParamSchema,
  listQuerySchema,
  updateClientSchemas,
} from './clients.schemas.js';

const parseId = (raw) => {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Cliente no encontrado');
  return parsed.data;
};

export function createClientsController({ service }) {
  const actor = (req) => req.session.userId;
  return {
    list: (req, res) => res.json(service.list(parseWith(listQuerySchema, req.query))),
    get: (req, res) => res.json({ data: service.get(parseId(req.params.id)) }),
    create(req, res) {
      const input = parseWith(createClientSchema, req.body);
      res.status(201).json({ data: service.create(actor(req), input) });
    },
    update(req, res) {
      const id = parseId(req.params.id);
      const { type } = service.get(id); // 404 si no existe; el tipo decide el esquema
      const input = parseWith(updateClientSchemas[type], req.body);
      res.json({ data: service.update(actor(req), id, input) });
    },
  };
}
