// Campana de notificaciones (RF-100): mantiene al día el contador del encabezado.
// Escucha el SSE («algo cambió») y vuelve a pedir el contador propio; nunca recibe datos ajenos.
(() => {
  const bell = document.querySelector('[data-notification-bell]');
  const badge = document.querySelector('[data-notification-count]');
  if (!bell || !badge || typeof EventSource === 'undefined') return;

  function show(count) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
    bell.setAttribute('aria-label', `Notificaciones, ${count} sin leer`);
  }

  async function refresh() {
    try {
      const response = await fetch('/api/v1/notifications/unread-count', {
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      show((await response.json()).data.unread);
    } catch {
      // sin conexión: se conserva el último valor
    }
  }

  const source = new EventSource('/api/v1/events');
  source.addEventListener('notification.created', refresh);
  source.addEventListener('notification.read', refresh);
})();
