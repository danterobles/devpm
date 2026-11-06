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
  const metricSelect = document.getElementById('burndown-metric');
  let chart = null;

  const cell = (text) => {
    const td = document.createElement('td');
    td.className = 'py-1 pr-4';
    td.textContent = text;
    return td;
  };
  const show = (value) => (value === null || value === undefined ? '—' : String(value));
  // En horas el API entrega minutos: se muestran como horas con un decimal.
  const convert = (data) => (value) =>
    value === null || data.unit !== 'minutes' ? value : Math.round((value / 60) * 10) / 10;
  const unitLabel = (data) => (data.metric === 'hours' ? 'h' : 'pts');

  function renderTable(data) {
    const to = convert(data);
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
        cell(show(to(data.ideal[i]))),
        cell(show(to(data.remaining[i]))),
        cell(show(data.scopeChanges[i])),
      );
      tableBody.append(tr);
    });
  }

  function renderSummary(data) {
    const to = convert(data);
    const unit = unitLabel(data);
    const lastIndex = data.remaining.findLastIndex((v) => v !== null);
    const parts = [];
    if (data.metric === 'points' && data.sprint.committedPoints !== null) {
      parts.push(`Comprometidos: ${data.sprint.committedPoints} pts`);
    }
    if (lastIndex !== -1) {
      parts.push(
        `Restantes: ${show(to(data.remaining[lastIndex]))} ${unit}`,
        `Ideal hoy: ${show(to(data.ideal[lastIndex]))} ${unit}`,
      );
    }
    if (data.metric === 'points') {
      const added = data.scopeChanges.filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const removed = data.scopeChanges.filter((v) => v < 0).reduce((a, b) => a + b, 0);
      parts.push(`Alcance agregado: +${added}`, `retirado: ${removed}`);
    }
    summary.textContent = parts.join(' · ');
  }

  function render(data) {
    const to = convert(data);
    const scope = data.scopeChanges.map((v) => (v === null || v === 0 ? null : v));
    chart?.destroy();
    chart = new Chart(canvas, {
      data: {
        labels: data.days,
        datasets: [
          {
            type: 'line',
            label: 'Ideal',
            data: data.ideal.map(to),
            borderColor: '#94a3b8',
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'Restante real',
            data: data.remaining.map(to),
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
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: data.metric === 'hours' ? 'Horas restantes' : 'Puntos restantes',
            },
          },
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
      const metric = metricSelect?.value ?? 'points';
      const response = await fetch(`/api/v1/sprints/${sprintId}/burndown?metric=${metric}`, {
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

  metricSelect?.addEventListener('change', load);
  load();
})();
