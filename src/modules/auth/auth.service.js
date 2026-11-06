import bcrypt from 'bcrypt';
import { AppError } from '../../lib/AppError.js';

// Hash de relleno: se compara aunque el correo no exista para igualar el tiempo de respuesta
// y no revelar qué correos están registrados.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);

export function createAuthService({ repository }) {
  return {
    /** Verifica credenciales. Mismo error para correo inexistente, contraseña mala o usuario inactivo. */
    async authenticate(email, password) {
      const user = repository.findByEmail(email);
      const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok || !user.is_active) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
      }
      repository.touchLastLogin(user.id);
      return { id: user.id, fullName: user.full_name, role: user.role };
    },
  };
}
