/* global Chart */
// Colores de texto y rejilla de Chart.js según el tema activo (RNF-12). Se carga después de Chart.js.
(() => {
  if (typeof Chart === 'undefined') return;
  function apply() {
    const dark = window.devpmTheme?.effective() === 'dark';
    Chart.defaults.color = dark ? '#dbe5f5' : '#334155';
    Chart.defaults.borderColor = dark ? 'rgba(185, 203, 235, 0.18)' : 'rgba(15, 23, 42, 0.1)';
  }
  apply();
  // Al cambiar el tema se actualizan los valores y se pide a la página que vuelva a dibujar.
  document.addEventListener('devpm:theme', () => {
    apply();
    document.dispatchEvent(new CustomEvent('devpm:refresh'));
  });
})();
