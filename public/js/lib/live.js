// Cliente de tiempo real (RF-91, RF-95): se conecta a GET /api/v1/events (SSE) y pide a la página
// que se actualice con el evento `devpm:refresh` (con *debounce*). Las notificaciones no traen
// datos: la página vuelve a leer sus propios endpoints, donde se aplican permisos y filtros.
//
// Uso: un contenedor `[data-live]` en la página con, opcionalmente,
//   data-live-project="12"        solo eventos de ese proyecto (y los globales)
//   data-live-types="task.,sprint." prefijos de los eventos que importan (vacío = todos)
//   data-live-debounce="500"      espera en ms antes de refrescar
// y un elemento `[data-live-status]` donde se muestra «En vivo» y la última actualización.
// La página escucha `devpm:refresh` para recargar y emite `devpm:loaded` al terminar de cargar.
(() => {
  const host = document.querySelector('[data-live]');
  if (!host || typeof EventSource === 'undefined') return;

  const KNOWN_EVENTS = [
    'project.created',
    'project.updated',
    'project.status_changed',
    'milestone.updated',
    'assignment.changed',
    'task.created',
    'task.updated',
    'task.status_changed',
    'task.deleted',
    'sprint.updated',
    'sprint.started',
    'sprint.closed',
    'time_entry.changed',
    'time_entry.approved',
    'team_member.updated',
    'time_off.changed',
    'client.updated',
    'settings.updated',
  ];

  const config = host.dataset;
  const prefixes = (config.liveTypes ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const debounceMs = Number(config.liveDebounce) > 0 ? Number(config.liveDebounce) : 500;
  const statusEl = host.querySelector('[data-live-status]');
  const url = config.liveProject
    ? `/api/v1/events?projectId=${encodeURIComponent(config.liveProject)}`
    : '/api/v1/events';

  let connection = 'connecting'; // connecting | live | reconnecting | offline
  let lastUpdate = null;
  let hadError = false;
  let timer = null;
  let pending = new Set();

  const pad = (n) => String(n).padStart(2, '0');
  const clock = (date) =>
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const LABELS = {
    connecting: 'Conectando…',
    live: 'En vivo',
    reconnecting: 'Reconectando…',
    offline: 'Sin conexión',
  };

  function paint() {
    if (!statusEl) return;
    const stamp = lastUpdate ? ` · Última actualización: ${clock(lastUpdate)}` : '';
    statusEl.textContent = `${LABELS[connection]}${stamp}`;
    if (statusEl.dataset) statusEl.dataset.state = connection;
  }

  function scheduleRefresh(type) {
    if (type !== null) pending.add(type);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const types = [...pending];
      pending = new Set();
      document.dispatchEvent(new CustomEvent('devpm:refresh', { detail: { types } }));
    }, debounceMs);
  }

  const source = new EventSource(url);

  source.addEventListener('open', () => {
    connection = 'live';
    paint();
    // Tras una reconexión se pudo perder algún evento: se pide un refresco.
    if (hadError) scheduleRefresh(null);
    hadError = false;
  });

  source.addEventListener('error', () => {
    hadError = true;
    // CLOSED (2): el navegador desistió (p. ej. sesión vencida); CONNECTING: reintentará solo.
    connection = source.readyState === 2 ? 'offline' : 'reconnecting';
    paint();
  });

  for (const type of KNOWN_EVENTS) {
    source.addEventListener(type, () => {
      if (prefixes.length > 0 && !prefixes.some((p) => type.startsWith(p))) return;
      scheduleRefresh(type);
    });
  }

  document.addEventListener('devpm:loaded', (event) => {
    lastUpdate = event.detail?.at ?? new Date();
    paint();
  });

  window.addEventListener('pagehide', () => source.close());
  globalThis.DevPMLive = { close: () => source.close() };
  paint();
})();
