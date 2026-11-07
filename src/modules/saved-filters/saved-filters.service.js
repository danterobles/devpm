import { AppError } from '../../lib/AppError.js';
import { MAX_PER_USER, canonicalQuery } from './saved-filters.schemas.js';

const toDto = (r) => ({ id: r.id, scope: r.scope, name: r.name, query: r.query });

/** Filtros guardados por persona (PRD §5.17): hasta 20, con nombre único por ámbito. */
export function createSavedFiltersService({ repository }) {
  return {
    list: (userId, scope) => repository.list(userId, scope).map(toDto),
    /** Cadena canónica de los filtros actuales de una página (para guardarlos o compararlos). */
    canonical: (scope, raw) => canonicalQuery(scope, raw).query,

    create(userId, { scope, name, query }) {
      const { query: canonical, errors } = canonicalQuery(scope, query);
      if (errors.length > 0) throw AppError.validation('Filtros inválidos', errors);
      if (canonical === '') {
        throw AppError.validation('Datos inválidos', [
          { field: 'query', message: 'Aplica al menos un filtro antes de guardarlo' },
        ]);
      }
      if (repository.count(userId) >= MAX_PER_USER) {
        throw AppError.businessRule(`Ya tienes ${MAX_PER_USER} filtros guardados (el máximo)`);
      }
      if (repository.nameTaken(userId, scope, name)) {
        throw AppError.conflict('Ya tienes un filtro con ese nombre en este listado');
      }
      const id = repository.insert(userId, scope, name, canonical);
      return toDto(repository.find(id, userId));
    },

    remove(userId, id) {
      if (!repository.remove(id, userId)) throw AppError.notFound('Filtro no encontrado');
    },
    find(userId, id) {
      const row = repository.find(id, userId);
      if (!row) throw AppError.notFound('Filtro no encontrado');
      return toDto(row);
    },
  };
}
