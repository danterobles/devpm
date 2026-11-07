import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { AppError } from '../../lib/AppError.js';
import { recordAudit } from '../../lib/audit.js';
import { ALLOWED_EXTENSIONS, detectType } from './fileTypes.js';

export const MAX_PER_TASK = 10;
const STORED = /^[a-f0-9]{32}$/;

/** Nombre para mostrar: sin rutas ni caracteres de control, máximo 120 caracteres. */
export function cleanName(raw) {
  const last = String(raw ?? '')
    .split(/[\\/]/)
    .pop();
  const printable = [...last].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127);
  const name = printable.join('').trim().replace(/^\.+/, '').slice(-120);
  return name || 'archivo';
}

export const toDto = (r) => ({
  id: r.id,
  taskId: r.task_id,
  name: r.original_name,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  uploadedBy: r.uploaded_by,
  uploaderName: r.uploader_name ?? 'Usuario eliminado',
  createdAt: r.created_at,
});

/**
 * Adjuntos de tareas (PRD §5.16). Suben `admin`, `pm` y los `developer` asignados al proyecto;
 * descarga cualquier usuario autenticado; elimina quien subió el archivo o un `admin`.
 * Los archivos viven en `uploadDir` con nombre aleatorio (nunca el original) y permisos `0600`.
 */
export function createAttachmentsService({ db, repository, uploadDir, maxBytes, events = null }) {
  const root = resolve(uploadDir);
  // La carpeta se crea con la primera subida (permisos 0700), no al arrancar.
  const ensureDir = () => {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
  };

  const pathOf = (stored) => {
    if (!STORED.test(stored)) throw AppError.notFound('Adjunto no encontrado');
    const full = resolve(root, stored);
    if (!full.startsWith(root + sep)) throw AppError.notFound('Adjunto no encontrado');
    return full;
  };
  const audit = (actorId, id, action, changes) =>
    recordAudit(db, { userId: actorId, entity: 'task_attachment', entityId: id, action, changes });

  function requireTask(taskId) {
    const task = repository.findTask(taskId);
    if (!task) throw AppError.notFound('Tarea no encontrada');
    return task;
  }
  function requireAttachment(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Adjunto no encontrado');
    return row;
  }
  function canUpload(actor, task) {
    if (['admin', 'pm'].includes(actor.role)) return true;
    if (actor.role !== 'developer') return false;
    const memberId = repository.memberOfUser(actor.id);
    return memberId !== null && repository.isAssigned(task.project_id, memberId);
  }

  return {
    maxBytes,
    /** Adjuntos de la tarea y si esta persona puede subir (para la vista). */
    view(actor, taskId) {
      const task = requireTask(taskId);
      return {
        items: repository.listByTask(taskId).map((r) => ({
          ...toDto(r),
          canDelete: r.uploaded_by === actor.id || actor.role === 'admin',
        })),
        canUpload: canUpload(actor, task),
        maxBytes,
        maxPerTask: MAX_PER_TASK,
        extensions: ALLOWED_EXTENSIONS,
      };
    },
    list(taskId) {
      requireTask(taskId);
      return repository.listByTask(taskId).map(toDto);
    },
    get: (id) => toDto(requireAttachment(id)),

    /** @param {Buffer} buffer contenido ya leído */
    upload(actor, taskId, rawName, buffer) {
      const task = requireTask(taskId);
      if (!canUpload(actor, task)) {
        throw AppError.forbidden('Solo el equipo asignado al proyecto puede adjuntar archivos');
      }
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw AppError.validation('Datos inválidos', [
          { field: 'file', message: 'El archivo está vacío' },
        ]);
      }
      if (buffer.length > maxBytes) {
        throw new AppError(
          413,
          'PAYLOAD_TOO_LARGE',
          `El archivo supera ${Math.round(maxBytes / 1048576)} MB`,
        );
      }
      const name = cleanName(rawName);
      const contentType = detectType(name, buffer);
      if (!contentType) {
        throw AppError.validation('Datos inválidos', [
          {
            field: 'file',
            message: `Tipo de archivo no permitido o que no corresponde a su extensión (permitidos: ${ALLOWED_EXTENSIONS.join(', ')})`,
          },
        ]);
      }
      if (repository.countByTask(taskId) >= MAX_PER_TASK) {
        throw AppError.businessRule(`La tarea ya tiene ${MAX_PER_TASK} adjuntos (el máximo)`);
      }
      ensureDir();
      const stored = randomBytes(16).toString('hex');
      const file = pathOf(stored);
      writeFileSync(file, buffer, { mode: 0o600, flag: 'wx' });
      let id;
      try {
        id = db.transaction(() => {
          const newId = repository.insert({
            taskId,
            userId: actor.id,
            originalName: name,
            storedName: stored,
            contentType,
            sizeBytes: buffer.length,
          });
          audit(actor.id, newId, 'create', { taskId: [null, taskId], name: [null, name] });
          return newId;
        })();
      } catch (err) {
        rmSync(file, { force: true }); // sin archivos huérfanos si falla el registro
        throw err;
      }
      events?.emit('attachment.changed', { projectId: task.project_id, taskId });
      return toDto(repository.findById(id));
    },

    /** Contenido y datos para la descarga. */
    download(id) {
      const row = requireAttachment(id);
      const file = pathOf(row.stored_name);
      if (!existsSync(file)) throw AppError.notFound('El archivo ya no está disponible');
      return { name: row.original_name, contentType: row.content_type, data: readFileSync(file) };
    },

    remove(actor, id) {
      const row = requireAttachment(id);
      if (row.uploaded_by !== actor.id && actor.role !== 'admin') {
        throw AppError.forbidden('Solo quien subió el archivo o un administrador puede eliminarlo');
      }
      const task = requireTask(row.task_id);
      db.transaction(() => {
        repository.remove(id);
        audit(actor.id, id, 'delete', { name: [row.original_name, null] });
      })();
      rmSync(pathOf(row.stored_name), { force: true });
      events?.emit('attachment.changed', { projectId: task.project_id, taskId: task.id });
    },

    /** Elimina los archivos de `uploadDir` que ya no tienen registro (p. ej. tras borrar una tarea). */
    sweep() {
      if (!existsSync(root)) return 0;
      const known = repository.allStoredNames();
      let removed = 0;
      for (const name of readdirSync(root)) {
        if (STORED.test(name) && !known.has(name)) {
          rmSync(join(root, name), { force: true });
          removed += 1;
        }
      }
      return removed;
    },
  };
}
