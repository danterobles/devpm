/** Error de aplicación con status HTTP y código estable (ver ARQUITECTURA §3.4). */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static validation(message = 'Datos inválidos', details) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Debes iniciar sesión') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'No tienes permiso para esta acción') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Recurso no encontrado') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message = 'Conflicto con el estado actual', details) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  static businessRule(message, details) {
    return new AppError(422, 'BUSINESS_RULE', message, details);
  }
}
