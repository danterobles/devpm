/* global Chart */
// Burnup del proyecto (RF-84) con Chart.js servido localmente.
// Lee GET /api/v1/projects/:id/burnup; solo escribe texto con textContent.
(() => {
  const root = document.querySelector('[data-burnup]');
  if (!root || typeof Chart === 'undefined') return;

  const projectId = root.dataset.projectId;
  const canvas = document.getElementById('burnup-chart');
  const message = document.getElementById('burnup-message');
  const summary = document.getElementById('burnup-summary');
  const tableBody = document.querySelector('#burnup-table tbody');
  let chart = null;

  const cell = (text) => {
    const td = document.createElement('td');
    td.className = 'py-1 pr-4';
    td.textContent = String(text);
    return td;
  };

  function renderTable(data) {
    tableBody.replaceChildren();
    data.days.forEach((day, i) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b';
      const first = document.createElement('th');
      first.scope = 'row';
      first.className = 'py-1 pr-4 text-left font-medium';
      first.textContent = day;
      tr.append(first, cell(data.scope[i]), cell(data.completed[i]), cell(data.remaining[i]));
      tableBody.append(tr);
    });
  }

  function render(data) {
    chart?.destroy();
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: data.days,
        datasets: [
          {
            label: 'Alcance total',
            data: data.scope,
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b',
            stepped: true, // el alcance cambia por saltos
            pointRadius: 2,
          },
          {
            label: 'Completado',
            data: data.completed,
            borderColor: '#10b981',
            backgroundColor: '#10b981',
            pointRadius: 2,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Puntos' } } },
      },
    });
  }

  async function load() {
    message.textContent = 'Cargando…';
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/burnup`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('No se pudo cargar el Burnup');
      const { data } = await response.json();
      if (data.days.length === 0) {
        message.textContent = 'El proyecto todavía no tiene instantáneas de sprints.';
        document.dispatchEvent(new CustomEvent('devpm:loaded', { detail: { at: new Date() } }));
        return;
      }
      message.textContent = '';
      const last = data.days.length - 1;
      summary.textContent = `Alcance: ${data.scope[last]} pts · Completado: ${data.completed[last]} pts · Pendiente: ${data.remaining[last]} pts`;
      render(data);
      renderTable(data);
      document.dispatchEvent(new CustomEvent('devpm:loaded', { detail: { at: new Date() } }));
    } catch (error) {
      message.textContent = error.message;
    }
  }

  document.addEventListener('devpm:refresh', load); // eventos de tareas y sprints (live.js)
  load();
})();
