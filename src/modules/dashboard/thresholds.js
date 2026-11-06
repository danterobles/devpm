/**
 * Umbrales de semáforo de los KPIs (PRD §6, RF-93). Son los valores de fábrica; se pueden
 * sobrescribir desde `settings` (clave `kpi.thresholds`).
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  k3: { green: 0.95, amber: 0.85 }, // SPI: ≥ green verde, ≥ amber ámbar, resto rojo
  k4: { green: 0.95, amber: 0.85 }, // CPI
  k5: { greenMargin: 10, amberMargin: 20 }, // consumo ≤ avance + margen
  k6: { greenMin: 75, greenMax: 95, amberMin: 60, amberMax: 105 }, // utilización (banda)
  k7: { greenMax: 0, amberMax: 2 },
  k9: { green: 85, amber: 70 },
  k10: { greenMax: 0, amberMax: 5 },
  k11: { greenMax: 0, amberMax: 3 },
  k15: { greenMax: 0, amberMax: 1 },
  k16: { green: 95, amber: 80 },
});

const higherIsBetter = (t, v) => (v >= t.green ? 'green' : v >= t.amber ? 'amber' : 'red');
const lowerIsBetter = (t, v) => (v <= t.greenMax ? 'green' : v <= t.amberMax ? 'amber' : 'red');
const inBand = (t, v) => {
  if (v >= t.greenMin && v <= t.greenMax) return 'green';
  if (v >= t.amberMin && v <= t.amberMax) return 'amber';
  return 'red';
};

const RULES = {
  k3: higherIsBetter,
  k4: higherIsBetter,
  k5: (t, v, ctx) => {
    if (ctx.progress === null || ctx.progress === undefined) return null;
    if (v <= ctx.progress + t.greenMargin) return 'green';
    return v <= ctx.progress + t.amberMargin ? 'amber' : 'red';
  },
  k6: inBand,
  k7: lowerIsBetter,
  k9: higherIsBetter,
  k10: lowerIsBetter,
  k11: lowerIsBetter,
  k15: lowerIsBetter,
  k16: higherIsBetter,
};

/**
 * Color del semáforo (`green` | `amber` | `red`) de un KPI, o `null` si no aplica o falta el dato.
 * @param {string} id p. ej. `k3`
 * @param {number|null} value
 * @param {typeof DEFAULT_THRESHOLDS} thresholds
 * @param {{ progress?: number|null }} [context] el avance (K2, en %) para comparar K5
 */
export function semaphore(id, value, thresholds, context = {}) {
  const rule = RULES[id];
  if (!rule || value === null || value === undefined || Number.isNaN(value)) return null;
  return rule(thresholds[id], value, context);
}
