import { AppError } from '../../lib/AppError.js';
import { parseWith } from '../../lib/parse.js';
import { SKILL_CATEGORIES, assignSkillSchema, skillIdSchema } from './skills.schemas.js';
import {
  TIME_OFF_TYPES,
  createTimeOffSchema,
  idSchema as timeOffIdSchema,
  timeOffQuerySchema,
  updateTimeOffSchema,
} from './timeoff.schemas.js';
import {
  POSITIONS,
  SENIORITIES,
  createMemberSchema,
  idParamSchema,
  listQuerySchema,
  updateMemberSchema,
} from './team.schemas.js';

const PRIVILEGED = ['admin', 'pm'];
const isPrivileged = (req) => PRIVILEGED.includes(req.session.role);

const parseId = (raw) => {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Miembro no encontrado');
  return parsed.data;
};

const parseSkillId = (raw) => {
  const parsed = skillIdSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Habilidad no encontrada');
  return parsed.data;
};

const parseTimeOffId = (raw) => {
  const parsed = timeOffIdSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound('Ausencia no encontrada');
  return parsed.data;
};

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const hoursToMinutes = (text) =>
  DECIMAL.test(String(text ?? '').trim()) ? Math.round(Number(text) * 60) : null;
const pesosToCents = (text) =>
  DECIMAL.test(String(text ?? '').trim()) ? Math.round(Number(text) * 100) : null;
export const minutesToHours = (m) => (m === null || m === undefined ? '' : String(m / 60));
export const centsToPesos = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

/** Mapea el cuerpo del formulario al contrato de la API (mismos esquemas Zod). */
function formToInput(body) {
  const input = {};
  for (const key of ['firstName', 'lastName', 'email', 'position', 'seniority', 'hireDate']) {
    if (body[key] !== undefined) input[key] = body[key];
  }
  const minutes = hoursToMinutes(body.weeklyHours);
  const cents = pesosToCents(body.hourlyCost);
  const details = [];
  if (minutes === null)
    details.push({ field: 'weeklyHours', message: 'Horas semanales inválidas' });
  if (cents === null) details.push({ field: 'hourlyCost', message: 'Costo por hora inválido' });
  if (details.length > 0) throw AppError.validation('Datos inválidos', details);
  return { ...input, weeklyCapacityMinutes: minutes, hourlyCostCents: cents };
}

const formView = (
  res,
  {
    status = 200,
    member,
    error = null,
    editing,
    canWrite,
    skills = [],
    skillError = null,
    timeOff = [],
    timeOffError = null,
    warning = null,
  },
) =>
  res.status(status).render('pages/team/form', {
    title: editing ? (canWrite ? 'Editar miembro' : 'Ficha del miembro') : 'Nuevo miembro',
    positions: POSITIONS,
    seniorities: SENIORITIES,
    member,
    error,
    editing,
    canWrite,
    skills,
    skillError,
    skillCategories: SKILL_CATEGORIES,
    timeOff,
    timeOffError,
    timeOffTypes: TIME_OFF_TYPES,
    warning,
  });

export function createTeamController({ service, skills, timeOff }) {
  const actor = (req) => req.session.userId;
  const opts = (req) => ({ includeCost: isPrivileged(req) });

  async function withForm(res, view, action) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof AppError && err.status < 500 && err.status !== 404) {
        return formView(res, {
          ...view,
          status: err.status,
          error: err.details?.[0]?.message ?? err.message,
        });
      }
      throw err;
    }
  }

  return {
    // ---- API JSON ----
    apiList: (req, res) => res.json(service.list(parseWith(listQuerySchema, req.query), opts(req))),
    apiGet: (req, res) => res.json({ data: service.get(parseId(req.params.id), opts(req)) }),
    apiCreate(req, res) {
      const input = parseWith(createMemberSchema, req.body);
      res.status(201).json({ data: service.create(actor(req), input) });
    },
    apiUpdate(req, res) {
      const id = parseId(req.params.id);
      const input = parseWith(updateMemberSchema, req.body);
      res.json({ data: service.update(actor(req), id, input) });
    },

    // ---- Habilidades (RF-21) ----
    apiSkillsList: (req, res) => res.json({ data: skills.list(parseId(req.params.id)) }),
    apiSkillAssign(req, res) {
      const input = parseWith(assignSkillSchema, req.body);
      const { created, skill } = skills.assign(actor(req), parseId(req.params.id), input);
      res.status(created ? 201 : 200).json({ data: skill });
    },
    apiSkillRemove(req, res) {
      skills.unassign(actor(req), parseId(req.params.id), parseSkillId(req.params.skillId));
      res.status(204).end();
    },
    async htmlSkillAssign(req, res) {
      const id = parseId(req.params.id);
      try {
        skills.assign(actor(req), id, parseWith(assignSkillSchema, req.body));
        return res.redirect(`/team/${id}`);
      } catch (err) {
        if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
        const member = service.get(id, opts(req));
        return formView(res, {
          status: err.status,
          member: {
            ...member,
            weeklyHours: minutesToHours(member.weeklyCapacityMinutes),
            hourlyCost: centsToPesos(member.hourlyCostCents),
          },
          editing: true,
          canWrite: true,
          skills: skills.list(id),
          timeOff: timeOff.list(id),
          skillError: err.details?.[0]?.message ?? err.message,
        });
      }
    },
    htmlSkillRemove(req, res) {
      const id = parseId(req.params.id);
      skills.unassign(actor(req), id, parseSkillId(req.params.skillId));
      res.redirect(`/team/${id}`);
    },

    // ---- Ausencias (RF-22) ----
    apiTimeOffList(req, res) {
      const range = parseWith(timeOffQuerySchema, req.query);
      res.json({ data: timeOff.list(parseId(req.params.id), range) });
    },
    apiTimeOffCreate(req, res) {
      const input = parseWith(createTimeOffSchema, req.body);
      res.status(201).json(timeOff.create(actor(req), parseId(req.params.id), input));
    },
    apiTimeOffUpdate(req, res) {
      const memberId = parseId(req.params.id);
      const id = parseTimeOffId(req.params.offId);
      const input = parseWith(updateTimeOffSchema, req.body);
      res.json(timeOff.update(actor(req), memberId, id, input));
    },
    apiTimeOffRemove(req, res) {
      timeOff.remove(actor(req), parseId(req.params.id), parseTimeOffId(req.params.offId));
      res.status(204).end();
    },
    htmlTimeOffCreate(req, res) {
      const memberId = parseId(req.params.id);
      try {
        const { warnings } = timeOff.create(
          actor(req),
          memberId,
          parseWith(createTimeOffSchema, req.body),
        );
        const flag = warnings.length > 0 ? '?warning=time-off-overlap' : '';
        return res.redirect(`/team/${memberId}${flag}`);
      } catch (err) {
        if (!(err instanceof AppError) || err.status >= 500 || err.status === 404) throw err;
        const member = service.get(memberId, opts(req));
        return formView(res, {
          status: err.status,
          member: {
            ...member,
            weeklyHours: minutesToHours(member.weeklyCapacityMinutes),
            hourlyCost: centsToPesos(member.hourlyCostCents),
          },
          editing: true,
          canWrite: true,
          skills: skills.list(memberId),
          timeOff: timeOff.list(memberId),
          timeOffError: err.details?.[0]?.message ?? err.message,
        });
      }
    },
    htmlTimeOffRemove(req, res) {
      const memberId = parseId(req.params.id);
      timeOff.remove(actor(req), memberId, parseTimeOffId(req.params.offId));
      res.redirect(`/team/${memberId}`);
    },

    // ---- Vistas HTML ----
    htmlList(req, res) {
      const query = parseWith(listQuerySchema, req.query);
      const { data, meta } = service.list(query, opts(req));
      const params = new URLSearchParams();
      if (query.q) params.set('q', query.q);
      if (query.status !== 'all') params.set('status', query.status);
      if (query.position !== 'all') params.set('position', query.position);
      const qs = params.toString();
      res.render('pages/team/index', {
        title: 'Equipo',
        members: data,
        meta,
        query,
        positions: POSITIONS,
        canWrite: isPrivileged(req),
        baseUrl: `/team${qs ? `?${qs}` : ''}`,
        minutesToHours,
        centsToPesos,
      });
    },
    htmlNew: (_req, res) =>
      formView(res, {
        member: { position: 'backend', seniority: 'mid', weeklyHours: '40', hourlyCost: '0.00' },
        editing: false,
        canWrite: true,
      }),
    htmlEdit(req, res) {
      const member = service.get(parseId(req.params.id), opts(req));
      formView(res, {
        member: {
          ...member,
          weeklyHours: minutesToHours(member.weeklyCapacityMinutes),
          hourlyCost: centsToPesos(member.hourlyCostCents),
        },
        editing: true,
        canWrite: isPrivileged(req),
        skills: skills.list(member.id),
        timeOff: timeOff.list(member.id),
        warning: req.query.warning === 'time-off-overlap' ? 'time-off-overlap' : null,
      });
    },
    htmlCreate(req, res) {
      const view = { member: { ...req.body }, editing: false, canWrite: true };
      return withForm(res, view, async () => {
        service.create(actor(req), parseWith(createMemberSchema, formToInput(req.body)));
        res.redirect('/team');
      });
    },
    htmlUpdate(req, res) {
      const id = parseId(req.params.id);
      service.get(id); // 404 si no existe
      const view = {
        member: { ...req.body, id, isActive: req.body.isActive === '1' },
        editing: true,
        canWrite: true,
        skills: skills.list(id),
        timeOff: timeOff.list(id),
      };
      return withForm(res, view, async () => {
        const input = { ...formToInput(req.body), isActive: req.body.isActive === '1' };
        service.update(actor(req), id, parseWith(updateMemberSchema, input));
        res.redirect('/team');
      });
    },
  };
}
