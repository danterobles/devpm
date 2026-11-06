import { AppError } from '../../lib/AppError.js';
import { recordAudit } from '../../lib/audit.js';

const toDto = (r) => ({
  skillId: r.skill_id,
  name: r.name,
  category: r.category,
  level: r.level,
});

/** Habilidades por miembro (RF-21). El catálogo `skills` se alimenta al asignar. */
export function createSkillsService({ db, repository }) {
  function requireMember(memberId) {
    if (!repository.memberExists(memberId)) throw AppError.notFound('Miembro no encontrado');
  }

  return {
    list(memberId) {
      requireMember(memberId);
      return repository.listByMember(memberId).map(toDto);
    },

    /** Asigna (o cambia el nivel de) una habilidad por nombre; la crea en el catálogo si no existe. */
    assign(actorId, memberId, { name, category = null, level }) {
      requireMember(memberId);
      return db.transaction(() => {
        let skillId = repository.findSkillIdByName(name);
        const existed = skillId !== null && repository.findAssigned(memberId, skillId);
        const previous = existed ? existed.level : null;
        if (skillId === null) skillId = repository.insertSkill(name, category);
        repository.setLevel(memberId, skillId, level);
        recordAudit(db, {
          userId: actorId,
          entity: 'team_member',
          entityId: memberId,
          action: 'update',
          changes: { [`skill:${name}`]: [previous, level] },
        });
        return { created: !existed, skill: toDto(repository.findAssigned(memberId, skillId)) };
      })();
    },

    unassign(actorId, memberId, skillId) {
      requireMember(memberId);
      const current = repository.findAssigned(memberId, skillId);
      if (!current) throw AppError.notFound('La habilidad no está asignada al miembro');
      db.transaction(() => {
        repository.unassign(memberId, skillId);
        recordAudit(db, {
          userId: actorId,
          entity: 'team_member',
          entityId: memberId,
          action: 'update',
          changes: { [`skill:${current.name}`]: [current.level, null] },
        });
      })();
    },
  };
}
