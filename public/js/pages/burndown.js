/* global Chart */
// Burndown del sprint (RF-80, RF-82) con Chart.js servido localmente.
// Lee GET /api/v1/sprints/:id/burndown; solo escribe texto con textContent.
(() => {
  const root = document.querySelector('[data-burndown]');
  if (!root || typeof Chart === 'undefined') return;

  const sprintId = root.dataset.sprintId;
  const canvas = document.getElementById('burndown-chart');
  const message = document.getElementById('burndown-message');
  const summary = document.getElementById('burndown-summary');
  const tableBody = document.querySelector('#burndown-table tbody');
  let chart = null;

  const cell = (text) => {
    const td = document.createElement('td');
    td.className = 'py-1 pr-4';
    td.textContent = text;
    return td;
  };
  const show = (value) => (value === null || value === undefined ? '—' : String(value));

  function renderTable(data) {
    tableBody.replaceChildren();
    data.days.forEach((day, i) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b';
      const first = document.createElement('th');
      first.scope = 'row';
      first.className = 'py-1 pr-4 text-left font-medium';
      first.textContent = day;
      tr.append(
        first,
        cell(show(data.ideal[i])),
        cell(show(data.remaining[i])),
        cell(show(data.scopeChanges[i])),
      );
      tableBody.append(tr);
    });
  }

  function renderSummary(data) {
    const lastReal = [...data.remaining].reverse().find((v) => v !== null);
    const lastIndex = data.remaining.findLastIndex((v) => v !== null);
    const added = data.scopeChanges.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const removed = data.scopeChanges.filter((v) => v < 0).reduce((a, b) => a + b, 0);
    const parts = [];
    if (data.sprint.committedPoints !== null)
      parts.push(`Comprometidos: ${data.sprint.committedPoints} pts`);
    if (lastReal !== undefined) {
      parts.push(`Restantes: ${lastReal} pts`, `Ideal hoy: ${show(data.ideal[lastIndex])} pts`);
    }
    parts.push(`Alcance agregado: +${added}`, `retirado: ${removed}`);
    summary.textContent = parts.join(' · ');
  }

  function render(data) {
    const scope = data.scopeChanges.map((v) => (v === null || v === 0 ? null : v));
    chart?.destroy();
    chart = new Chart(canvas, {
      data: {
        labels: data.days,
        datasets: [
          {
            type: 'line',
            label: 'Ideal',
            data: data.ideal,
            borderColor: '#94a3b8',
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'Restante real',
            data: data.remaining,
            borderColor: '#2563eb',
            backgroundColor: '#2563eb',
            pointRadius: 3,
            spanGaps: false, // los días sin dato (futuro) quedan sin línea
            tension: 0,
            yAxisID: 'y',
          },
          {
            type: 'bar',
            label: 'Cambio de alcance',
            data: scope,
            backgroundColor: scope.map((v) => (v > 0 ? '#f59e0b' : '#10b981')),
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Puntos restantes' } },
          y2: {
            display: scope.some((v) => v !== null), // solo si hubo cambios de alcance
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Alcance (+/−)' },
            ticks: { precision: 0 },
          },
        },
      },
    });
  }

  async function load() {
    message.textContent = 'Cargando…';
    try {
      const response = await fetch(`/api/v1/sprints/${sprintId}/burndown`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('No se pudo cargar el Burndown');
      const { data } = await response.json();
      message.textContent = data.remaining.every((v) => v === null)
        ? 'Este sprint todavía no tiene instantáneas (se guardan al iniciarlo).'
        : '';
      render(data);
      renderTable(data);
      renderSummary(data);
    } catch (error) {
      message.textContent = error.message;
    }
  }

  load();
})();
