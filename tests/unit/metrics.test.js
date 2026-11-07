import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../../src/lib/metrics.js';

// Métricas de solicitudes en memoria (RF-172).
function run(metrics, { path = '/x', status = 200, ms = 10 }, clock) {
  let finish;
  const res = { statusCode: status, on: (_e, fn) => (finish = fn) };
  metrics.middleware({ path }, res, () => {});
  clock.t += ms;
  finish?.();
}
const fakeClock = () => {
  const c = { t: 0, wall: 1_700_000_000_000 };
  return c;
};

test('cuenta solicitudes y errores y calcula p50, p95 y máxima', () => {
  const c = fakeClock();
  const m = createMetrics({ now: () => c.wall, clock: () => c.t });
  for (let i = 1; i <= 100; i += 1)
    run(m, { ms: i, status: i === 100 ? 500 : i % 10 === 0 ? 404 : 200 }, c);
  const s = m.snapshot();
  assert.equal(s.totalRequests, 100);
  assert.equal(s.recentRequests, 100);
  assert.equal(s.recentServerErrors, 1);
  assert.equal(s.totalServerErrors, 1);
  assert.equal(s.recentClientErrors, 9);
  assert.equal(s.p50Ms, 50);
  assert.equal(s.p95Ms, 95);
  assert.equal(s.maxMs, 100);
});

test('sin solicitudes las latencias son nulas; las conexiones SSE no se miden', () => {
  const c = fakeClock();
  const m = createMetrics({ now: () => c.wall, clock: () => c.t });
  assert.deepEqual(
    [m.snapshot().p50Ms, m.snapshot().p95Ms, m.snapshot().maxMs],
    [null, null, null],
  );
  run(m, { path: '/api/v1/events', ms: 60_000 }, c);
  assert.equal(m.snapshot().totalRequests, 0);
});

test('solo las solicitudes de la ventana cuentan como recientes y el anillo conserva las últimas', () => {
  const c = fakeClock();
  const m = createMetrics({ size: 3, now: () => c.wall, clock: () => c.t });
  run(m, { status: 500 }, c);
  c.wall += 20 * 60 * 1000; // 20 min después
  for (let i = 0; i < 4; i += 1) run(m, { ms: 5 }, c);
  const s = m.snapshot(15 * 60 * 1000);
  assert.equal(s.totalRequests, 5);
  assert.equal(s.totalServerErrors, 1, 'el total histórico conserva el error');
  assert.equal(s.recentRequests, 3, 'el anillo solo guarda las últimas 3');
  assert.equal(s.recentServerErrors, 0, 'el error quedó fuera de la ventana');
  assert.equal(s.uptimeSeconds, 1200);
});
