// Conversación de la tarea en vivo (RF-134): al llegar `comment.changed` se vuelve a pedir la página y
// se reemplaza la sección. Conserva lo que la persona está escribiendo. Solo usa DOMParser, nunca
// inserta texto como marcado.
(() => {
  const section = document.querySelector('[data-comments]');
  if (!section) return;

  async function refresh() {
    const typing = section.querySelector('#new-comment')?.value ?? '';
    const editing = section.querySelector('details[open]');
    if (editing || document.activeElement?.closest('[data-comments] textarea')) return; // no pisar una edición
    try {
      const response = await fetch(window.location.pathname, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) return;
      const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');
      const next = fresh.querySelector('[data-comments]');
      if (!next) return;
      const status = section.querySelector('[data-live-status]')?.textContent ?? '';
      section.replaceChildren(...next.childNodes);
      const box = section.querySelector('#new-comment');
      if (box) box.value = typing;
      const statusEl = section.querySelector('[data-live-status]');
      if (statusEl) statusEl.textContent = status;
      document.dispatchEvent(new CustomEvent('devpm:loaded', { detail: { at: new Date() } }));
    } catch {
      // sin conexión: live.js ya lo informa
    }
  }
  document.addEventListener('devpm:refresh', refresh);
  document.dispatchEvent(new CustomEvent('devpm:loaded', { detail: { at: new Date() } }));
})();
