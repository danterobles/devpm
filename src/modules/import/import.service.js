import { AppError } from '../../lib/AppError.js';
import { csvCell, parseCsv } from '../../lib/csv.js';
import { createClientsRepository } from '../clients/clients.repository.js';
import { createClientsService } from '../clients/clients.service.js';
import { createTeamRepository } from '../team/team.repository.js';
import { createTeamService } from '../team/team.service.js';
import { createTasksRepository } from '../tasks/tasks.repository.js';
import { createTasksService } from '../tasks/tasks.service.js';
import { ENTITIES, columnOf } from './import.entities.js';

export const MAX_ROWS = 1000;
const ROLLBACK = Symbol('rollback');

/**
 * Importación por CSV (PRD §5.14). La validación **ejecuta las altas reales** dentro de una
 * transacción que siempre se revierte: así los errores son exactamente los que daría la pantalla
 * (duplicados, reglas de negocio, responsable asignado al proyecto…), incluso entre filas del
 * propio archivo. Si no hay errores, el mismo recorrido se confirma (todo o nada).
 */
export function createImportService({ db, events = null, timezone = 'America/Mexico_City' }) {
  // Los eventos se acumulan y solo se emiten al confirmar la transacción exterior.
  const deferred = {
    queue: null,
    emit(type, payload) {
      if (this.queue) this.queue.push([type, payload]);
      else events?.emit(type, payload);
    },
  };
  const services = {
    clients: createClientsService({
      db,
      repository: createClientsRepository(db),
      events: deferred,
    }),
    team: createTeamService({ db, repository: createTeamRepository(db), events: deferred }),
    // Sin notificador: una carga masiva no debe avisar tarea por tarea a cada responsable.
    tasks: createTasksService({
      db,
      repository: createTasksRepository(db),
      events: deferred,
      timezone,
    }),
  };
  const memberByEmail = db.prepare(
    'SELECT id FROM team_members WHERE lower(email) = lower(?) AND is_active = 1',
  );
  const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?');

  const messagesOf = (entity, err) =>
    Array.isArray(err.details) && err.details.length > 0
      ? err.details.map((d) => `${columnOf(entity, d.field)}: ${d.message}`)
      : [err.message];

  /** @returns {{ fatal: string|null, header?: string[], items?: object[] }} */
  function read(entity, text) {
    const def = ENTITIES[entity];
    if (!def) throw AppError.notFound('Entidad no importable');
    if (typeof text !== 'string' || text.trim() === '')
      return { fatal: 'Carga un archivo CSV o pega su contenido.' };
    const { header, rows } = parseCsv(text);
    const missing = def.columns
      .filter((c) => c.required && !header.includes(c.key))
      .map((c) => c.key);
    if (missing.length > 0)
      return {
        fatal: `Faltan columnas obligatorias: ${missing.join(', ')}. Descarga la plantilla.`,
      };
    if (rows.length === 0) return { fatal: 'El archivo no tiene filas de datos.' };
    if (rows.length > MAX_ROWS)
      return { fatal: `El archivo tiene ${rows.length} filas; el máximo es ${MAX_ROWS}.` };
    const known = new Set(def.columns.map((c) => c.key));
    const items = rows.map((r) => ({
      line: r.line,
      values: Object.fromEntries(
        header.filter((h) => known.has(h)).map((h) => [h, r.cells[header.indexOf(h)] ?? '']),
      ),
      errors: [],
    }));
    return { fatal: null, header, items, ignored: header.filter((h) => !known.has(h)) };
  }

  /** Recorre las filas dando de alta; con `commit` falso (o si hubo errores) revierte todo. */
  function run(actor, entity, items, { projectId, commit }) {
    const def = ENTITIES[entity];
    const ctx = {
      db,
      services,
      actorId: actor.id,
      projectId,
      memberByEmail: (email) => memberByEmail.get(email)?.id ?? null,
    };
    for (const item of items) item.errors = [];
    deferred.queue = [];
    try {
      db.transaction(() => {
        for (const item of items) {
          try {
            def.create(ctx, def.validate(def.toInput(item.values, ctx)));
          } catch (err) {
            if (!(err instanceof AppError)) throw err;
            item.errors = messagesOf(entity, err);
          }
        }
        if (!commit || items.some((i) => i.errors.length > 0)) throw ROLLBACK;
      })();
    } catch (err) {
      if (err !== ROLLBACK) {
        deferred.queue = null;
        throw err;
      }
      deferred.queue = null;
      return false;
    }
    const queued = deferred.queue;
    deferred.queue = null;
    for (const [type, payload] of queued) events?.emit(type, payload);
    return true;
  }

  function prepare(entity, text, projectId) {
    const def = ENTITIES[entity];
    if (def?.needsProject && !projectExists.get(projectId ?? 0))
      return { fatal: 'Elige el proyecto al que se importarán las tareas.' };
    return read(entity, text);
  }

  const summarize = (entity, parsed, imported) => ({
    entity,
    fatal: parsed.fatal,
    ignoredColumns: parsed.ignored ?? [],
    total: parsed.items?.length ?? 0,
    errorCount: parsed.items?.filter((i) => i.errors.length > 0).length ?? 0,
    rows: parsed.items ?? [],
    imported,
  });

  return {
    /** Vista previa: valida todas las filas sin guardar nada. */
    validate(actor, entity, text, { projectId } = {}) {
      const parsed = prepare(entity, text, projectId);
      if (parsed.fatal) return summarize(entity, parsed, 0);
      run(actor, entity, parsed.items, { projectId, commit: false });
      return summarize(entity, parsed, 0);
    },
    /** Importa: todo o nada. Si hay errores no guarda nada y los devuelve. */
    commit(actor, entity, text, { projectId } = {}) {
      const parsed = prepare(entity, text, projectId);
      if (parsed.fatal) return summarize(entity, parsed, 0);
      const ok = run(actor, entity, parsed.items, { projectId, commit: true });
      return summarize(entity, parsed, ok ? parsed.items.length : 0);
    },
    /** Plantilla CSV (encabezados y una fila de ejemplo). */
    template(entity) {
      const def = ENTITIES[entity];
      if (!def) throw AppError.notFound('Entidad no importable');
      const line = (cells) => cells.map(csvCell).join(',');
      return (
        '﻿' +
        [line(def.columns.map((c) => c.key)), line(def.columns.map((c) => c.example))].join(
          '\r\n',
        ) +
        '\r\n'
      );
    },
  };
}
