import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { createClientSchema } from '../clients/clients.schemas.js';
import { createMemberSchema } from '../team/team.schemas.js';
import { createTaskSchema } from '../tasks/tasks.schemas.js';

/**
 * Definición de cada entidad importable (PRD §5.14): plantilla, mapeo de la fila CSV al contrato de
 * la API (mismos esquemas Zod que las pantallas) y alta mediante el service existente.
 */
const DECIMAL = /^\d+([.,]\d{1,2})?$/;
const number = (text) => Number(String(text).replace(',', '.'));

/** Una columna: encabezado CSV (español), campo de la API que valida y ejemplo para la plantilla. */
const col = (key, field, example, required = false) => ({ key, field, example, required });

function fail(details) {
  throw AppError.validation('Datos inválidos', details);
}
const pick = (row, ...keys) => Object.fromEntries(keys.map((k) => [k, row[k] ?? '']));

export const ENTITIES = {
  clients: {
    label: 'Clientes',
    columns: [
      col('tipo', 'type', 'externo', true),
      col('nombre', 'name', 'Grupo Aurora', true),
      col('departamento', 'department', ''),
      col('centro_costos', 'costCenter', ''),
      col('razon_social', 'legalName', 'Grupo Aurora SA de CV'),
      col('rfc', 'taxId', 'GAU010101AAA'),
      col('tarifa_hora', 'hourlyRateCents', '950.00'),
      col('moneda', 'currency', 'MXN'),
      col('direccion', 'address', ''),
      col('contacto', 'contactName', 'Rosa Vega'),
      col('correo_contacto', 'contactEmail', 'rosa@aurora.example'),
      col('telefono_contacto', 'contactPhone', ''),
      col('notas', 'notes', ''),
    ],
    toInput(row) {
      const type = { interno: 'internal', externo: 'external' }[row.tipo.toLowerCase()];
      if (!type) fail([{ field: 'tipo', message: 'Debe ser «interno» o «externo»' }]);
      const common = pick(row, 'contacto', 'correo_contacto', 'telefono_contacto', 'notas');
      const base = {
        type,
        name: row.nombre,
        contactName: common.contacto,
        contactEmail: common.correo_contacto,
        contactPhone: common.telefono_contacto,
        notes: common.notas,
      };
      if (type === 'internal') {
        return { ...base, department: row.departamento ?? '', costCenter: row.centro_costos ?? '' };
      }
      const rate = String(row.tarifa_hora ?? '').trim();
      if (!DECIMAL.test(rate))
        fail([{ field: 'tarifa_hora', message: 'Tarifa inválida (p. ej. 950.00)' }]);
      return {
        ...base,
        legalName: row.razon_social ?? '',
        taxId: row.rfc ?? '',
        hourlyRateCents: Math.round(number(rate) * 100),
        currency: (row.moneda || 'MXN').toUpperCase(),
        address: row.direccion ?? '',
      };
    },
    validate: (input) => parseWith(createClientSchema, input),
    create: (ctx, input) => {
      const exists = ctx.db
        .prepare('SELECT 1 FROM clients WHERE type = ? AND lower(name) = lower(?)')
        .get(input.type, input.name);
      if (exists)
        throw AppError.conflict(
          `Ya existe un cliente ${input.type === 'internal' ? 'interno' : 'externo'} llamado «${input.name}»`,
        );
      ctx.services.clients.create(ctx.actorId, input);
    },
  },

  members: {
    label: 'Miembros del equipo',
    columns: [
      col('nombre', 'firstName', 'Ana', true),
      col('apellido', 'lastName', 'Ruiz', true),
      col('correo', 'email', 'ana.ruiz@empresa.com', true),
      col('puesto', 'position', 'backend', true),
      col('nivel', 'seniority', 'mid', true),
      col('horas_semana', 'weeklyCapacityMinutes', '40'),
      col('costo_hora', 'hourlyCostCents', '350.00'),
      col('fecha_ingreso', 'hireDate', '2026-01-15'),
    ],
    toInput(row) {
      const hours = String(row.horas_semana ?? '').trim();
      const cost = String(row.costo_hora ?? '').trim();
      const details = [];
      if (hours && !DECIMAL.test(hours))
        details.push({ field: 'horas_semana', message: 'Horas semanales inválidas' });
      if (cost && !DECIMAL.test(cost))
        details.push({ field: 'costo_hora', message: 'Costo por hora inválido' });
      if (details.length > 0) fail(details);
      const input = {
        firstName: row.nombre,
        lastName: row.apellido,
        email: row.correo,
        position: row.puesto,
        seniority: row.nivel,
        hireDate: row.fecha_ingreso ?? '',
      };
      if (hours) input.weeklyCapacityMinutes = Math.round(number(hours) * 60);
      if (cost) input.hourlyCostCents = Math.round(number(cost) * 100);
      return input;
    },
    validate: (input) => parseWith(createMemberSchema, input),
    create: (ctx, input) => ctx.services.team.create(ctx.actorId, input),
  },

  tasks: {
    label: 'Tareas de un proyecto',
    needsProject: true,
    columns: [
      col('titulo', 'title', 'Diseñar el modelo de datos', true),
      col('tipo', 'type', 'feature'),
      col('prioridad', 'priority', 'medium'),
      col('puntos', 'storyPoints', '5'),
      col('estimacion_horas', 'estimatedMinutes', '8'),
      col('responsable_correo', 'assigneeId', 'ana.ruiz@empresa.com'),
      col('fecha_inicio', 'startDate', '2026-06-01'),
      col('fecha_fin', 'dueDate', '2026-06-05'),
      col('descripcion', 'description', ''),
    ],
    toInput(row, ctx) {
      const details = [];
      const input = { title: row.titulo, description: row.descripcion ?? '' };
      if (row.tipo) input.type = row.tipo;
      if (row.prioridad) input.priority = row.prioridad;
      if (row.puntos) {
        input.storyPoints = Number(row.puntos);
        if (Number.isNaN(input.storyPoints))
          details.push({ field: 'puntos', message: 'Puntos inválidos' });
      }
      if (row.estimacion_horas) {
        if (!DECIMAL.test(row.estimacion_horas))
          details.push({ field: 'estimacion_horas', message: 'Estimación en horas inválida' });
        else input.estimatedMinutes = Math.round(number(row.estimacion_horas) * 60);
      }
      if (row.fecha_inicio) input.startDate = row.fecha_inicio;
      if (row.fecha_fin) input.dueDate = row.fecha_fin;
      if (row.responsable_correo) {
        const memberId = ctx.memberByEmail(row.responsable_correo);
        if (memberId === null)
          details.push({
            field: 'responsable_correo',
            message: 'No existe un miembro con ese correo',
          });
        else input.assigneeId = memberId;
      }
      if (details.length > 0) fail(details);
      return input;
    },
    validate: (input) => parseWith(createTaskSchema, input),
    create: (ctx, input) => ctx.services.tasks.create(ctx.actorId, ctx.projectId, input),
  },
};

/** Campo de la API → encabezado del CSV, para mostrar los errores con el nombre de la columna. */
export function columnOf(entity, field) {
  return ENTITIES[entity].columns.find((c) => c.field === field)?.key ?? field;
}
