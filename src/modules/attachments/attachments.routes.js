import express, { Router } from 'express';
import { AppError } from '../../lib/AppError.js';
import { requireRole } from '../../middlewares/requireRole.js';
import { idSchema } from '../comments/comments.schemas.js';

const parseId = (raw, message) => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound(message);
  return parsed.data;
};

/**
 * Adjuntos de tareas. La subida es el cuerpo binario de la petición (sin dependencias de carga de
 * archivos) con el nombre en `?name=`. La descarga es siempre un archivo adjunto, nunca una página.
 */
export function createAttachmentsRouter({ service, onChange = () => {} }) {
  const write = requireRole('admin', 'pm', 'developer');
  const raw = express.raw({ type: () => true, limit: service.maxBytes });
  const tooLarge = (err, _req, _res, next) =>
    next(
      err?.type === 'entity.too.large'
        ? new AppError(
            413,
            'PAYLOAD_TOO_LARGE',
            `El archivo supera ${Math.round(service.maxBytes / 1048576)} MB`,
          )
        : err,
    );
  const actor = (req) => ({ id: req.session.userId, role: req.session.role });
  const taskId = (req) => parseId(req.params.id, 'Tarea no encontrada');
  const attachmentId = (req) => parseId(req.params.id, 'Adjunto no encontrado');

  function send(req, res) {
    const file = service.download(attachmentId(req));
    res.attachment(file.name); // Content-Disposition: attachment (con el nombre codificado)
    res.set({
      'Content-Type': file.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(file.data);
  }

  const router = Router();
  router.get('/api/v1/tasks/:id/attachments', (req, res) =>
    res.json({ data: service.list(taskId(req)) }),
  );
  router.post('/api/v1/tasks/:id/attachments', write, raw, tooLarge, (req, res) => {
    const created = service.upload(actor(req), taskId(req), req.query.name, req.body);
    onChange(created);
    res.status(201).json({ data: created });
  });
  router.get('/api/v1/attachments/:id', send);
  router.get('/attachments/:id', send);
  router.delete('/api/v1/attachments/:id', write, (req, res) => {
    service.remove(actor(req), attachmentId(req));
    res.status(204).end();
  });
  router.post('/attachments/:id/delete', write, (req, res) => {
    const id = attachmentId(req);
    const task = service.get(id).taskId;
    service.remove(actor(req), id);
    res.redirect(`/tasks/${task}#adjuntos`);
  });
  return router;
}
