// «Mi día» en vivo (RF-110): al llegar eventos se vuelve a pedir la página y se reemplaza el panel.
// El HTML se analiza con DOMParser (nunca se inserta texto como marcado).
(() => {
  const root = document.querySelector('[data-home]');
  if (!root) return;

  async function refresh() {
    try {
      const response = await fetch(window.location.href, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) return;
      const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');
      const next = fresh.querySelector('[data-home]');
      if (!next) return;
      const status = root.querySelector('[data-live-status]')?.textContent ?? '';
      root.replaceChildren(...next.childNodes);
      const statusEl = root.querySelector('[data-live-status]');
      if (statusEl) statusEl.textContent = status;
      document.dispatchEvent(new CustomEvent('devpm:loaded', { detail: { at: new Date() } }));
    } catch {
      // sin conexión: el indicador de live.js ya lo informa
    }
  }
  document.addEventListener('devpm:refresh', refresh);
  document.dispatchEvent(new CustomEvent('devpm:loaded', { detail: { at: new Date() } }));
})();
