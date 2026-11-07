import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

// npm run health (RF-173): código 0 solo si /health responde 200 con status ok.
const servers = [];
after(() => servers.forEach((s) => s.close()));

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}/health`);
    });
  });
}
function run(url, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/healthcheck.js'], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: { ...process.env, HEALTH_URL: url, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('sale con 0 cuando /health responde 200 y status ok', async () => {
  const url = await serve((_req, res) =>
    res.end(JSON.stringify({ status: 'ok', db: 'ok', uptime: 12 })),
  );
  const r = await run(url);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK .* base ok · activo 12 s/);
});

test('sale con 1 si la aplicación está degradada (503) o el estado no es ok', async () => {
  const degraded = await serve((_req, res) => {
    res.statusCode = 503;
    res.end(JSON.stringify({ status: 'degraded', db: 'error', uptime: 1 }));
  });
  const a = await run(degraded);
  assert.equal(a.code, 1);
  assert.match(a.out, /FALLA .* HTTP 503/);
  const odd = await serve((_req, res) => res.end(JSON.stringify({ status: 'raro' })));
  assert.equal((await run(odd)).code, 1);
  const html = await serve((_req, res) => res.end('<html>no es JSON</html>'));
  assert.equal((await run(html)).code, 1);
});

test('sale con 1 si no hay nadie escuchando o no responde a tiempo', async () => {
  const closed = await serve((_req, res) => res.end('{}'));
  servers.pop().close();
  assert.equal((await run(closed)).code, 1);
  const hung = await serve(() => {});
  const r = await run(hung, { HEALTH_TIMEOUT_MS: '300' });
  assert.equal(r.code, 1);
  assert.match(r.out, /sin respuesta en 300 ms/);
});
