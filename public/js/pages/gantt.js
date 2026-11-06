/* global Gantt */
// Gantt del proyecto (RF-70 a RF-72) con Frappe Gantt servido localmente.
// Lee GET /api/v1/projects/:id/gantt y solo escribe texto con textContent;
// los popups escapan todo el contenido dinámico.
(() => {
  const root = document.querySelector('[data-gantt]');
  if (!root || typeof Gantt === 'undefined') return;

  const projectId = root.dataset.projectId;
  const target = document.getElementById('gantt');
  const message = document.getElementById('gantt-message');
  const unscheduled = document.getElementById('gantt-unscheduled');
  const groupToggle = document.querySelector('input[name="groupBy"]');
  const modeButtons = [...document.querySelectorAll('[data-view-mode]')];

  let chart = null;
  let viewMode = 'Week';

  const escapeHtml = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  const STATUS = {
    backlog: 'Backlog',
    todo: 'Por hacer',
    in_progress: 'En progreso',
    in_review: 'En revisión',
    blocked: 'Bloqueada',
    done: 'Hecha',
    pending: 'Pendiente',
    completed: 'Cumplido',
    missed: 'Incumplido',
  };

  function popup(task) {
    const meta = task.meta ?? {};
    const lines = [
      `<strong>${escapeHtml(task.name)}</strong>`,
      `${escapeHtml(task.start)} → ${escapeHtml(task.end)}`,
      `${escapeHtml(meta.kind === 'milestone' ? 'Hito' : 'Tarea')} · ${escapeHtml(STATUS[meta.status] ?? meta.status)}`,
    ];
    if (meta.kind === 'task') lines.push(`Avance: ${Number(task.progress)} %`);
    if (meta.assigneeName) lines.push(`Responsable: ${escapeHtml(meta.assigneeName)}`);
    if (meta.sprintName) lines.push(`Sprint: ${escapeHtml(meta.sprintName)}`);
    return `<div class="p-2 text-sm">${lines.join('<br />')}</div>`;
  }

  function setMode(mode) {
    viewMode = mode;
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.viewMode === mode));
    }
    if (chart) chart.change_view_mode(mode);
  }

  function renderUnscheduled(items) {
    unscheduled.replaceChildren();
    for (const item of items) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/tasks/${item.id}`;
      link.className = 'underline';
      link.textContent = item.title;
      li.append(link, ` (${STATUS[item.status] ?? item.status})`);
      unscheduled.append(li);
    }
    unscheduled.closest('section').hidden = items.length === 0;
  }

  async function load() {
    message.textContent = 'Cargando…';
    const groupBy = groupToggle?.checked ? 'sprint' : 'none';
    let data;
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/gantt?groupBy=${groupBy}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('No se pudo cargar el Gantt');
      data = (await response.json()).data;
    } catch (error) {
      message.textContent = error.message;
      return;
    }
    renderUnscheduled(data.unscheduled);
    target.replaceChildren();
    if (data.tasks.length === 0) {
      chart = null;
      message.textContent = 'No hay tareas ni hitos con fechas para dibujar.';
      return;
    }
    message.textContent = '';
    chart = new Gantt(target, data.tasks, {
      view_mode: viewMode,
      language: 'es',
      today_button: true,
      view_mode_select: false,
      scroll_to: 'today',
      popup_on: 'hover',
      custom_popup_html: popup,
      readonly: true, // la reprogramación (RF-73) se habilita aparte
    });
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.viewMode));
  }
  groupToggle?.addEventListener('change', load);
  setMode(viewMode);
  load();
})();
