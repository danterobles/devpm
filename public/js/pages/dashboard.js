/* global Chart */
// Tablero de KPIs (RF-90, RF-93, RF-94). Lee GET /api/v1/dashboard/kpis con los filtros de la URL.
// Solo escribe texto con textContent. El semáforo siempre lleva texto además del color.
(() => {
  const root = document.querySelector('[data-dashboard]');
  if (!root || typeof Chart === 'undefined') return;

  const cardsEl = document.getElementById('kpi-cards');
  const riskEl = document.getElementById('risk-list');
  const tableBody = document.querySelector('#projects-table tbody');
  const message = document.getElementById('dashboard-message');
  const rangeEl = document.getElementById('dashboard-range');
  const charts = {};

  // ---- Formato ----
  const dash = '—';
  const num = (v, suffix = '') => (v === null || v === undefined ? dash : `${v}${suffix}`);
  const hours = (minutes) => `${(Math.round((minutes / 60) * 10) / 10).toLocaleString('es-MX')} h`;
  const money = (cents, currency) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100);

  // Barra lateral de color + texto «Semáforo: …» (el color nunca es el único indicador).
  const STATUS = {
    green: {
      label: 'Verde',
      bar: 'bg-emerald-500',
      text: 'text-emerald-800 dark:text-emerald-300',
    },
    amber: { label: 'Ámbar', bar: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-300' },
    red: { label: 'Rojo', bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300' },
  };
  const NO_STATUS = {
    bar: 'bg-navy-300 dark:bg-navy-600',
    text: 'text-navy-600 dark:text-navy-300',
  };

  const BY_STATUS = {
    planning: 'planeación',
    active: 'activos',
    on_hold: 'en pausa',
    completed: 'completados',
    cancelled: 'cancelados',
  };

  // ---- Definición de las tarjetas (K1–K16) ----
  const cards = (k, canSeeRevenue) => {
    const list = [
      {
        id: 'K1',
        title: 'Proyectos activos',
        value: String(k.k1.value),
        detail: Object.entries(k.k1.byStatus)
          .map(([s, n]) => `${n} ${BY_STATUS[s]}`)
          .join(' · '),
      },
      {
        id: 'K2',
        title: 'Avance (puntos hechos)',
        value: num(k.k2.value, ' %'),
        detail: `${k.k2.donePoints} de ${k.k2.totalPoints} pts`,
      },
      {
        id: 'K3',
        title: 'SPI (calendario)',
        value: num(k.k3.value),
        status: k.k3.status,
        detail: 'EV ÷ PV',
      },
      {
        id: 'K4',
        title: 'CPI (costo en horas)',
        value: num(k.k4.value),
        status: k.k4.status,
        detail: `EV ${hours(k.k4.earnedMinutes)} · AC ${hours(k.k4.actualMinutes)}`,
      },
      {
        id: 'K5',
        title: 'Consumo de presupuesto',
        value: num(k.k5.value, ' %'),
        status: k.k5.status,
        detail: `Avance ${num(k.k5.progress, ' %')}`,
      },
      {
        id: 'K6',
        title: 'Utilización del equipo',
        value: num(k.k6.value, ' %'),
        status: k.k6.status,
        detail: `${hours(k.k6.loggedMinutes)} de ${hours(k.k6.capacityMinutes)}`,
      },
      {
        id: 'K7',
        title: 'Miembros sobreasignados',
        value: String(k.k7.value),
        status: k.k7.status,
        detail: '> 100 % algún día hábil',
      },
      {
        id: 'K8',
        title: 'Velocidad del sprint',
        value: k.k8.value === null ? dash : `${k.k8.value} pts`,
        detail: `Promedio de 3: ${num(k.k8.average, ' pts')}`,
      },
      {
        id: 'K9',
        title: 'Cumplimiento de compromiso',
        value: num(k.k9.value, ' %'),
        status: k.k9.status,
        detail: `${k.k9.completedPoints} de ${k.k9.committedPoints} pts`,
      },
      {
        id: 'K10',
        title: 'Tareas vencidas',
        value: String(k.k10.value),
        status: k.k10.status,
        detail: 'No terminadas con fecha pasada',
      },
      {
        id: 'K11',
        title: 'Tareas bloqueadas',
        value: String(k.k11.value),
        status: k.k11.status,
        detail: 'Estado «bloqueada»',
      },
      {
        id: 'K12',
        title: 'Cycle time promedio',
        value: k.k12.value === null ? dash : `${k.k12.value} d`,
        detail: `${k.k12.tasks} tareas terminadas`,
      },
      {
        id: 'K13',
        title: 'Horas facturables',
        value: hours(k.k13.billableMinutes),
        detail: `No facturables: ${hours(k.k13.nonBillableMinutes)}`,
      },
    ];
    if (canSeeRevenue && k.k14) {
      list.push({
        id: 'K14',
        title: 'Ingreso estimado',
        value:
          k.k14.byCurrency.length === 0
            ? dash
            : k.k14.byCurrency.map((c) => money(c.cents, c.currency)).join(' · '),
        detail: 'Horas facturables aprobadas × tarifa',
      });
    }
    list.push(
      {
        id: 'K15',
        title: 'Hitos vencidos',
        value: String(k.k15.value),
        status: k.k15.status,
        detail: 'No cumplidos con fecha pasada',
      },
      {
        id: 'K16',
        title: 'Registro de horas de la semana',
        value: num(k.k16.value, ' %'),
        status: k.k16.status,
        detail: `${hours(k.k16.loggedMinutes)} de ${hours(k.k16.capacityMinutes)}`,
      },
    );
    return list;
  };

  function renderCards(kpis) {
    cardsEl.replaceChildren();
    for (const card of cards(kpis, root.dataset.canSeeRevenue === 'true')) {
      const st = STATUS[card.status];
      const look = st ?? NO_STATUS;
      const article = document.createElement('article');
      article.className =
        'relative overflow-hidden rounded-xl border border-navy-100 bg-white p-4 pl-6 shadow-sm dark:border-white/10';
      const bar = document.createElement('span');
      bar.className = `absolute inset-y-0 left-0 w-1.5 ${look.bar}`;
      bar.setAttribute('aria-hidden', 'true');
      const title = document.createElement('h3');
      title.className =
        'text-xs font-semibold uppercase tracking-wide text-navy-600 dark:text-navy-300';
      title.textContent = `${card.id} · ${card.title}`;
      const value = document.createElement('p');
      value.className = 'mt-1 text-3xl font-bold tabular-nums';
      value.textContent = card.value;
      const detail = document.createElement('p');
      detail.className = 'mt-1 text-xs text-navy-600 dark:text-navy-300';
      detail.textContent = card.detail;
      const badge = document.createElement('p');
      badge.className = `mt-2 text-xs font-semibold ${look.text}`;
      badge.textContent = st ? `Semáforo: ${st.label}` : 'Sin semáforo';
      article.append(bar, title, value, detail, badge);
      cardsEl.append(article);
    }
  }

  function renderRisk(risk) {
    riskEl.replaceChildren();
    for (const project of risk) {
      const li = document.createElement('li');
      li.className = 'py-3';
      const link = document.createElement('a');
      link.href = `/projects/${project.id}`;
      link.className = 'font-medium underline';
      link.textContent = `${project.code} · ${project.name}`;
      const causes = document.createElement('ul');
      causes.className = 'mt-1 list-disc pl-5 text-slate-700';
      for (const cause of project.causes) {
        const item = document.createElement('li');
        item.textContent = cause.message;
        causes.append(item);
      }
      li.append(link, causes);
      riskEl.append(li);
    }
    if (risk.length === 0) {
      const li = document.createElement('li');
      li.className = 'py-3 text-slate-600';
      li.textContent = 'Ningún proyecto activo está en riesgo.';
      riskEl.append(li);
    }
  }

  function renderTable(projects) {
    tableBody.replaceChildren();
    for (const p of projects) {
      const tr = document.createElement('tr');
      tr.className = 'border-b';
      const name = document.createElement('th');
      name.scope = 'row';
      name.className = 'py-2 pr-4 text-left font-medium';
      const link = document.createElement('a');
      link.href = `/projects/${p.id}`;
      link.className = 'underline';
      link.textContent = `${p.code} · ${p.name}`;
      name.append(link);
      tr.append(name);
      for (const text of [
        num(p.progress, ' %'),
        num(p.spi),
        num(p.cpi),
        num(p.consumption, ' %'),
        p.endDate,
      ]) {
        const td = document.createElement('td');
        td.className = 'py-2 pr-4';
        td.textContent = text;
        tr.append(td);
      }
      tableBody.append(tr);
    }
    if (projects.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'py-3 text-slate-600';
      td.textContent = 'No hay proyectos activos con estos filtros.';
      tr.append(td);
      tableBody.append(tr);
    }
  }

  // ---- Gráficas ----
  function draw(id, config) {
    charts[id]?.destroy();
    charts[id] = new Chart(document.getElementById(id), {
      ...config,
      options: { responsive: true, maintainAspectRatio: false, ...config.options },
    });
  }

  function renderCharts(data) {
    const { k13, k8 } = data.kpis;
    const toHours = (m) => Math.round((m / 60) * 10) / 10;
    draw('hours-chart', {
      type: 'bar',
      data: {
        labels: ['Interno', 'Externo'],
        datasets: [
          {
            label: 'Facturables',
            backgroundColor: '#10b981',
            data: [
              k13.byClientType.internal.billableMinutes,
              k13.byClientType.external.billableMinutes,
            ].map(toHours),
          },
          {
            label: 'No facturables',
            backgroundColor: '#94a3b8',
            data: [
              k13.byClientType.internal.nonBillableMinutes,
              k13.byClientType.external.nonBillableMinutes,
            ].map(toHours),
          },
        ],
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
    });

    const history = [...k8.history].reverse();
    draw('velocity-chart', {
      data: {
        labels: history.map((h) => `${h.projectCode} · ${h.name}`),
        datasets: [
          {
            type: 'bar',
            label: 'Puntos completados',
            data: history.map((h) => h.points),
            backgroundColor: '#2563eb',
          },
          {
            type: 'line',
            label: 'Promedio',
            data: history.map(() => k8.average),
            borderColor: '#f59e0b',
            pointRadius: 0,
          },
        ],
      },
      options: { scales: { y: { beginAtZero: true } } },
    });

    draw('progress-chart', {
      type: 'bar',
      data: {
        labels: data.projects.map((p) => p.code),
        datasets: [
          {
            label: 'Avance %',
            data: data.projects.map((p) => p.progress ?? 0),
            backgroundColor: '#2563eb',
          },
          {
            label: 'Consumo %',
            data: data.projects.map((p) => p.consumption ?? 0),
            backgroundColor: '#f59e0b',
          },
        ],
      },
      options: { indexAxis: 'y', scales: { x: { beginAtZero: true, suggestedMax: 100 } } },
    });
  }

  // ---- Carga ----
  async function load() {
    message.textContent = 'Cargando…';
    try {
      const response = await fetch(`/api/v1/dashboard/kpis${window.location.search}`, {
        credentials: 'same-origin',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          body?.error?.details?.[0]?.message ||
            body?.error?.message ||
            'No se pudo cargar el tablero',
        );
      const { data } = body;
      message.textContent = '';
      rangeEl.textContent = `Periodo: ${data.range.from} a ${data.range.to} · Hoy: ${data.today}`;
      renderCards(data.kpis);
      renderRisk(data.risk);
      renderTable(data.projects);
      renderCharts(data);
      document.dispatchEvent(new CustomEvent('devpm:loaded', { detail: { at: new Date() } }));
    } catch (error) {
      message.textContent = error.message;
    }
  }

  // live.js pide el refresco cuando llegan eventos de dominio.
  document.addEventListener('devpm:refresh', load);
  load();
})();
