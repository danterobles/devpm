/* global Gantt */
// Gantt de portafolio (RF-74): un renglón por proyecto activo. Solo lectura; al hacer clic en una
// barra se abre el Gantt del proyecto. Solo escribe texto con textContent y escapa los popups.
(() => {
  const root = document.querySelector('[data-gantt-portfolio]');
  if (!root || typeof Gantt === 'undefined') return;

  const target = document.getElementById('gantt-portfolio');
  const message = document.getElementById('portfolio-message');
  const modeButtons = [...document.querySelectorAll('[data-view-mode]')];
  let chart = null;
  let viewMode = 'Month';

  const escapeHtml = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  function popup(task) {
    const meta = task.meta ?? {};
    const lines = [
      `<strong>${escapeHtml(task.name)}</strong>`,
      `${escapeHtml(task.start)} → ${escapeHtml(task.end)}`,
      `Avance: ${Number(task.progress)} %`,
      `Cliente: ${escapeHtml(meta.clientName)}`,
    ];
    if (meta.managerName) lines.push(`Líder: ${escapeHtml(meta.managerName)}`);
    lines.push(`Prioridad: ${escapeHtml(meta.priority)}`);
    return `<div class="p-2 text-sm">${lines.join('<br />')}</div>`;
  }

  function setMode(mode) {
    viewMode = mode;
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.viewMode === mode));
    }
    if (chart) chart.change_view_mode(mode);
  }

  async function load() {
    message.textContent = 'Cargando…';
    let data;
    try {
      const response = await fetch('/api/v1/gantt/portfolio', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('No se pudo cargar el portafolio');
      data = (await response.json()).data;
    } catch (error) {
      message.textContent = error.message;
      return;
    }
    target.replaceChildren();
    if (data.projects.length === 0) {
      message.textContent = 'No hay proyectos activos.';
      return;
    }
    message.textContent = '';
    chart = new Gantt(target, data.projects, {
      view_mode: viewMode,
      language: 'es',
      today_button: true,
      view_mode_select: false,
      scroll_to: 'today',
      popup_on: 'hover',
      custom_popup_html: popup,
      readonly: true,
      on_click: (task) => {
        window.location.assign(`/projects/${task.meta.projectId}/gantt`);
      },
    });
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.viewMode));
  }
  setMode(viewMode);
  load();
})();
