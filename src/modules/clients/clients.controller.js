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

const TYPE_LABELS = {
  internal: { plural: 'Clientes internos', singular: 'cliente interno' },
  external: { plural: 'Clientes externos', singular: 'cliente externo' },
};
const COMMON_FIELDS = ['name', 'contactName', 'contactEmail', 'contactPhone', 'notes'];
const TYPE_FIELDS = {
  internal: ['department', 'costCenter'],
  external: ['legalName', 'taxId', 'currency', 'address'],
};
const RATE_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Convierte pesos (texto del formulario) a centavos enteros; null si el formato es inválido. */
const rateToCents = (text) =>
  RATE_PATTERN.test(String(text ?? '').trim()) ? Math.round(Number(text) * 100) : null;
export const centsToRate = (cents) =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);

/** Mapea el cuerpo del formulario HTML al contrato de la API (mismos esquemas Zod). */
function formToInput(type, body) {
  const input = {};
  for (const key of [...COMMON_FIELDS, ...TYPE_FIELDS[type]]) {
    if (body[key] !== undefined) input[key] = body[key];
  }
  if (input.currency !== undefined) input.currency = String(input.currency).trim().toUpperCase();
  if (type === 'external') {
    const cents = rateToCents(body.hourlyRate);
    if (cents === null) {
      throw AppError.validation('Datos inválidos', [
        { field: 'hourlyRate', message: 'Tarifa inválida (número positivo con hasta 2 decimales)' },
      ]);
    }
    input.hourlyRateCents = cents;
  }
  return input;
}

const formView = (
  res,
  { status = 200, type, client, error = null, editing, canWrite, summary = null },
) =>
  res.status(status).render('pages/clients/form', {
    title: `${editing ? 'Editar' : 'Nuevo'} ${TYPE_LABELS[type].singular}`,
    type,
    labels: TYPE_LABELS[type],
    client,
    error,
    editing,
    canWrite,
    summary,
    centsToRate,
  });

export function createClientsController({ service }) {
  const actor = (req) => req.session.userId;
  return {
    list: (req, res) => res.json(service.list(parseWith(listQuerySchema, req.query))),
    get: (req, res) => res.json({ data: service.get(parseId(req.params.id)) }),
    summary: (req, res) => res.json({ data: service.summary(parseId(req.params.id)) }),
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

    // ---- Vistas HTML (por tipo) ----
    html(type) {
      const canWrite = (req) => ['admin', 'pm'].includes(req.session.role);
      const loadOfType = (req) => {
        const client = service.get(parseId(req.params.id));
        if (client.type !== type) throw AppError.notFound('Cliente no encontrado');
        return client;
      };
      /** Si la acción falla por una regla de entrada, vuelve a mostrar el formulario con el mensaje. */
      async function withForm(req, res, view, action) {
        try {
          return await action();
        } catch (err) {
          if (err instanceof AppError && err.status < 500 && err.status !== 404) {
            const error = err.details?.[0]?.message ?? err.message;
            return formView(res, { ...view, status: err.status, error });
          }
          throw err;
        }
      }
      const echo = (body, extra = {}) => ({ ...body, ...extra });

      return {
        list(req, res) {
          const query = parseWith(listQuerySchema, { ...req.query, type });
          const { data, meta } = service.list(query);
          const params = new URLSearchParams();
          if (query.q) params.set('q', query.q);
          if (query.status !== 'all') params.set('status', query.status);
          const qs = params.toString();
          res.render('pages/clients/index', {
            title: TYPE_LABELS[type].plural,
            type,
            labels: TYPE_LABELS[type],
            clients: data,
            meta,
            query,
            canWrite: canWrite(req),
            baseUrl: `/clients/${type}${qs ? `?${qs}` : ''}`,
            centsToRate,
          });
        },
        newForm: (req, res) =>
          formView(res, {
            type,
            client: { currency: 'MXN', isActive: true },
            editing: false,
            canWrite: true,
          }),
        edit(req, res) {
          const client = loadOfType(req);
          formView(res, {
            type,
            client: { ...client, hourlyRate: centsToRate(client.hourlyRateCents) },
            editing: true,
            canWrite: canWrite(req),
            summary: service.summary(client.id),
          });
        },
        create(req, res) {
          const view = {
            type,
            client: echo(req.body, { isActive: true }),
            editing: false,
            canWrite: true,
          };
          return withForm(req, res, view, async () => {
            const input = parseWith(createClientSchema, { type, ...formToInput(type, req.body) });
            service.create(actor(req), input);
            res.redirect(`/clients/${type}`);
          });
        },
        update(req, res) {
          const id = parseId(req.params.id);
          loadOfType(req);
          const view = {
            type,
            client: echo(req.body, { id, isActive: req.body.isActive === '1' }),
            editing: true,
            canWrite: true,
          };
          return withForm(req, res, view, async () => {
            const input = {
              ...formToInput(type, req.body),
              isActive: req.body.isActive === '1',
            };
            service.update(actor(req), id, parseWith(updateClientSchemas[type], input));
            res.redirect(`/clients/${type}`);
          });
        },
      };
    },
  };
}
