/**
 * Métricas de solicitudes en memoria (PRD §5.19): un anillo con las últimas `size` solicitudes. Se
 * reinician con el proceso y no se envían a ningún servicio externo. Las conexiones SSE (de larga
 * duración) no se miden.
 */
export function createMetrics({
  size = 1000,
  now = () => Date.now(),
  clock = () => performance.now(),
} = {}) {
  const ring = [];
  let next = 0;
  const startedAt = now();
  let total = 0;
  let errors = 0;

  const percentile = (sorted, p) =>
    sorted.length === 0
      ? null
      : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);

  return {
    middleware(req, res, next_) {
      if (req.path === '/api/v1/events') return next_();
      const t0 = clock();
      res.on('finish', () => {
        const entry = { at: now(), status: res.statusCode, ms: clock() - t0 };
        total += 1;
        if (entry.status >= 500) errors += 1;
        if (ring.length < size) ring.push(entry);
        else {
          ring[next] = entry;
          next = (next + 1) % size;
        }
      });
      next_();
    },
    /** @param {number} windowMs ventana para «recientes» */
    snapshot(windowMs = 15 * 60 * 1000) {
      const since = now() - windowMs;
      const recent = ring.filter((e) => e.at >= since);
      const times = recent.map((e) => e.ms).sort((a, b) => a - b);
      return {
        startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds: Math.round((now() - startedAt) / 1000),
        totalRequests: total,
        totalServerErrors: errors,
        windowMinutes: Math.round(windowMs / 60000),
        recentRequests: recent.length,
        recentServerErrors: recent.filter((e) => e.status >= 500).length,
        recentClientErrors: recent.filter((e) => e.status >= 400 && e.status < 500).length,
        p50Ms: round(percentile(times, 0.5)),
        p95Ms: round(percentile(times, 0.95)),
        maxMs: round(times.length ? times[times.length - 1] : null),
      };
    },
  };
}
