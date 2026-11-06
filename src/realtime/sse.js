import { Router } from 'express';
import { z } from 'zod';
import { parseWith } from '../lib/parse.js';
import { requireAuth } from '../middlewares/requireAuth.js';

const querySchema = z.object({ projectId: z.coerce.number().int().positive().optional() });

/**
 * Endpoint SSE `GET /api/v1/events` (RF-91, ARQUITECTURA §4). Solo usuarios autenticados.
 * Envía notificaciones («algo cambió»), nunca datos: los permisos y filtros se aplican en los
 * endpoints de lectura. Heartbeat cada 25 s, `retry` de 3 s y limpieza al desconectar.
 * @param {{ eventBus: ReturnType<import('./eventBus.js').createEventBus>, heartbeatMs?: number }} deps
 */
export function createSse({ eventBus, heartbeatMs = 25_000 }) {
  const clients = new Set();

  const router = Router();
  router.get('/api/v1/events', requireAuth, (req, res) => {
    const { projectId } = parseWith(querySchema, req.query);

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // desactiva el buffering en nginx
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    // Con filtro por proyecto: sus eventos y los globales (los que no traen projectId).
    const wanted = (event) =>
      projectId === undefined || event.projectId === undefined || event.projectId === projectId;
    const unsubscribe = eventBus.subscribe((event) => {
      if (!wanted(event)) return;
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    heartbeat.unref();

    const client = {
      close() {
        res.end();
      },
    };
    clients.add(client);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      clients.delete(client);
    });
  });

  return {
    router,
    clientCount: () => clients.size,
    /** Cierra todas las conexiones abiertas (apagado ordenado). */
    closeAll() {
      for (const client of [...clients]) client.close();
    },
  };
}
