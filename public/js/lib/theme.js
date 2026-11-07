// Tema de color (RNF-12): «Sistema» (por defecto), «Claro» u «Oscuro». Se guarda solo en el navegador.
// Se carga en <head> sin `defer` para aplicar el tema antes de pintar y evitar el destello.
(() => {
  const KEY = 'devpm.theme';
  const CHOICES = ['system', 'light', 'dark'];
  const root = document.documentElement;

  function read() {
    try {
      const value = localStorage.getItem(KEY);
      return CHOICES.includes(value) ? value : 'system';
    } catch {
      return 'system'; // almacenamiento bloqueado: se sigue la preferencia del sistema
    }
  }

  function apply(choice) {
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
  }

  /** Tema efectivo: lo que se está viendo (para las gráficas). */
  function effective() {
    const forced = root.getAttribute('data-theme');
    if (forced === 'light' || forced === 'dark') return forced;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function save(choice) {
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // sin almacenamiento: el cambio vale solo para esta página
    }
    apply(choice);
    markButtons(choice);
    document.dispatchEvent(new CustomEvent('devpm:theme', { detail: { theme: effective() } }));
  }

  function markButtons(choice) {
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
    }
  }

  apply(read());
  window.devpmTheme = { effective };

  document.addEventListener('DOMContentLoaded', () => {
    markButtons(read());
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.addEventListener('click', () => save(button.dataset.themeChoice));
    }
  });
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () =>
      document.dispatchEvent(new CustomEvent('devpm:theme', { detail: { theme: effective() } })),
    );
})();
