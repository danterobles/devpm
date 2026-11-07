// Comprobación de salud para monitores y cron (RF-173).
// Uso: npm run health   (variables: HEALTH_URL, o PORT para http://localhost:PORT/health)
// Sale con 0 si GET /health responde 200 y {"status":"ok"}; con 1 en cualquier otro caso.
const url = process.env.HEALTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}/health`;
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS ?? 5000);

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 200 && body.status === 'ok') {
    console.log(`OK ${url} · base ${body.db} · activo ${body.uptime} s`);
    process.exit(0);
  }
  console.error(`FALLA ${url} · HTTP ${res.status} · ${JSON.stringify(body)}`);
} catch (err) {
  console.error(
    `FALLA ${url} · ${err.name === 'TimeoutError' ? `sin respuesta en ${timeoutMs} ms` : err.message}`,
  );
}
process.exit(1);
