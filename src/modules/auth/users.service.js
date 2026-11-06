import bcrypt from 'bcrypt';
import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';

export const toDto = (r) => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  role: r.role,
  teamMemberId: r.team_member_id,
  isActive: r.is_active === 1,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Casos de uso de administración de usuarios (RF-03, RF-04).
 * @param {{ db: object, repository: object, sessionStore?: { destroyByUser(id: number): number }, bcryptCost?: number }} deps
 */
export function createUsersService({ db, repository, sessionStore = null, bcryptCost = 12 }) {
  const hash = (password) => bcrypt.hash(password, bcryptCost);

  function requireUser(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Usuario no encontrado');
    return row;
  }

  function checkEmail(email, exceptId = null) {
    const owner = repository.findIdByEmail(email);
    if (owner !== null && owner !== exceptId)
      throw AppError.conflict('El correo ya está registrado');
  }

  function checkTeamMember(teamMemberId, exceptUserId = null) {
    if (teamMemberId === null || teamMemberId === undefined) return;
    if (!repository.teamMemberExists(teamMemberId)) {
      throw AppError.businessRule('El miembro del equipo no existe');
    }
    const owner = repository.findIdByTeamMember(teamMemberId);
    if (owner !== null && owner !== exceptUserId) {
      throw AppError.conflict('El miembro del equipo ya está vinculado a otro usuario');
    }
  }

  const service = {
    list(query) {
      const { rows, total } = repository.list(query);
      return {
        data: rows.map(toDto),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    },

    get: (id) => toDto(requireUser(id)),

    async create(actorId, input) {
      checkEmail(input.email);
      checkTeamMember(input.teamMemberId);
      const passwordHash = await hash(input.password);
      const id = db.transaction(() => {
        const newId = repository.insert({
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: input.role,
          teamMemberId: input.teamMemberId ?? null,
        });
        recordAudit(db, {
          userId: actorId,
          entity: 'user',
          entityId: newId,
          action: 'create',
          changes: { email: [null, input.email], role: [null, input.role] },
        });
        return newId;
      })();
      return toDto(repository.findById(id));
    },

    async update(actorId, id, input) {
      const before = requireUser(id);
      if (actorId === id) {
        if (input.isActive === false) {
          throw AppError.businessRule('No puedes desactivarte a ti mismo');
        }
        if (input.role !== undefined && input.role !== 'admin') {
          throw AppError.businessRule('No puedes quitarte el rol de administrador');
        }
      }
      if (input.email !== undefined) checkEmail(input.email, id);
      if (input.teamMemberId !== undefined) checkTeamMember(input.teamMemberId, id);

      const { password, ...rest } = input;
      const fields = { ...rest };
      if (password !== undefined) fields.passwordHash = await hash(password);

      db.transaction(() => {
        repository.update(id, fields);
        const after = repository.findById(id);
        const changes = diff(
          { ...before, password_hash: undefined },
          { ...after, password_hash: undefined },
        );
        if (password !== undefined) changes.password = [null, '(cambiada)'];
        if (Object.keys(changes).length > 0) {
          recordAudit(db, {
            userId: actorId,
            entity: 'user',
            entityId: id,
            action: 'update',
            changes,
          });
        }
      })();

      const after = repository.findById(id);
      const sessionInvalidated =
        password !== undefined || after.is_active === 0 || after.role !== before.role;
      if (sessionInvalidated) sessionStore?.destroyByUser(id);
      return toDto(after);
    },

    /** La baja es lógica: desactiva al usuario (los usuarios no se eliminan). */
    deactivate: (actorId, id) => service.update(actorId, id, { isActive: false }),
  };
  return service;
}
