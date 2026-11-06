import { AppError } from '../../lib/AppError.js';
import { addDays } from '../../lib/dates.js';
import { parseWith } from '../../lib/parse.js';
import { mondayOf } from './time-entries.service.js';
import {
  createEntrySchema,
  idSchema,
  listQuerySchema,
  sheetQuerySchema,
  updateEntrySchema,
} from './time-entries.schemas.js';

const parseId = (raw) => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Registro de tiempo no encontrado');
  return parsed.data;
};

const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** Formulario de la hoja → contrato de la API (horas decimales a minutos, vacíos a null). */
function formToInput(body) {
  if (!DECIMAL.test(String(body.hours ?? '').trim())) {
    throw AppError.validation('Datos inválidos', [
      { field: 'hours', message: 'Las horas deben ser un número positivo (hasta 2 decimales)' },
    ]);
  }
  return {
    projectId: Number(body.projectId),
    taskId: body.taskId ? Number(body.taskId) : null,
    workDate: body.workDate,
    minutes: Math.round(Number(body.hours) * 60),
    description: body.description,
  };
}
export const minutesToHours = (m) => `${(m / 60).toFixed(1)} h`;

export function createTimeEntriesController({ service }) {
  const actor = (req) => ({ id: req.session.userId, role: req.session.role });

  function sheetPage(req, res, { status = 200, error = null, form = {}, query = req.query } = {}) {
    const data = service.sheet(actor(req), parseWith(sheetQuerySchema, query));
    const options = data.isOwn ? service.formOptions(actor(req), data.weekStart) : null;
    res.status(status).render('pages/time/sheet', {
      title: 'Hoja de tiempos',
      ...data,
      options,
      error,
      form,
      prevWeek: addDays(data.weekStart, -7),
      nextWeek: addDays(data.weekStart, 7),
      minutesToHours,
      memberQuery: data.isOwn ? '' : `&memberId=${data.member.id}`,
    });
  }
  function entryPage(req, res, id, { status = 200, error = null, form = null } = {}) {
    const entry = service.get(actor(req), id);
    const options = service.formOptions(actor(req), mondayOf(entry.workDate));
    res.status(status).render('pages/time/entry', {
      title: 'Registro de tiempo',
      entry: form ? { ...entry, ...form } : entry,
      hours: String(entry.minutes / 60),
      options,
      editable: ['draft', 'rejected'].includes(entry.status),
      isOwn: service.isOwn(actor(req), entry),
      error,
    });
  }
  const knownError = (err) => err instanceof AppError && err.status < 500 && err.status !== 404;
  const message = (err) => err.details?.[0]?.message ?? err.message;

  return {
    sheetApi: (req, res) =>
      res.json({ data: service.sheet(actor(req), parseWith(sheetQuerySchema, req.query)) }),
    htmlSheet: (req, res) => sheetPage(req, res),
    htmlCreate(req, res) {
      try {
        const input = parseWith(createEntrySchema, formToInput(req.body));
        service.create(actor(req), input);
        return res.redirect(`/time?week=${input.workDate}`);
      } catch (err) {
        if (!knownError(err)) throw err;
        const week = /^\d{4}-\d{2}-\d{2}$/.test(req.body.workDate ?? '')
          ? req.body.workDate
          : undefined;
        return sheetPage(req, res, {
          status: err.status,
          error: message(err),
          form: req.body,
          query: { week },
        });
      }
    },
    htmlEntry: (req, res) => entryPage(req, res, parseId(req.params.id)),
    htmlUpdate(req, res) {
      const id = parseId(req.params.id);
      try {
        const input = parseWith(updateEntrySchema, formToInput(req.body));
        service.update(actor(req), id, input);
        return res.redirect(`/time?week=${input.workDate}`);
      } catch (err) {
        if (!knownError(err)) throw err;
        return entryPage(req, res, id, { status: err.status, error: message(err), form: req.body });
      }
    },
    htmlRemove(req, res) {
      const id = parseId(req.params.id);
      const { workDate } = service.get(actor(req), id);
      try {
        service.remove(actor(req), id);
        return res.redirect(`/time?week=${workDate}`);
      } catch (err) {
        if (!knownError(err)) throw err;
        return entryPage(req, res, id, { status: err.status, error: message(err) });
      }
    },

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
