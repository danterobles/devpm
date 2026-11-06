/* global Gantt */
// Gantt del proyecto (RF-70 a RF-72) con Frappe Gantt servido localmente.
// Lee GET /api/v1/projects/:id/gantt y solo escribe texto con textContent;
// los popups escapan todo el contenido dinámico.
(() => {
  const root = document.querySelector('[data-gantt]');
  if (!root || typeof Gantt === 'undefined') return;

  const projectId = root.dataset.projectId;
  const canReschedule = root.dataset.canReschedule === 'true';
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

  // Fecha local YYYY-MM-DD (Frappe entrega Date; el fin ya viene como último día inclusivo).
  const isoDate = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  // RF-73: persiste las nuevas fechas; si el servidor las rechaza, la barra regresa a su lugar.
  async function reschedule(task, start, end) {
    if (task.meta?.kind !== 'task') {
      await load();
      message.textContent = 'Los hitos se reprograman desde la ficha del proyecto.';
      return;
    }
    try {
      const response = await fetch(`/api/v1/tasks/${task.meta.taskId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: isoDate(start), dueDate: isoDate(end) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || 'No se pudo reprogramar la tarea');
      }
      message.textContent = `«${task.name}» reprogramada: ${isoDate(start)} → ${isoDate(end)}`;
    } catch (error) {
      await load();
      message.textContent = error.message;
    }
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
      readonly: !canReschedule, // RF-73: solo admin y pm arrastran las barras
      readonly_progress: true, // el avance se calcula, no se edita
      move_dependencies: false, // sin cascada: cada tarea se reprograma por separado
      on_date_change: reschedule,
    });
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.viewMode));
  }
  groupToggle?.addEventListener('change', load);
  setMode(viewMode);
  load();
})();
