// Utilidades de fechas. `now()` es inyectable en pruebas (ARQUITECTURA §9).
let clock = () => new Date();

/** Reemplaza el reloj (solo pruebas). Sin argumento lo restaura. */
export function setClock(fn) {
  clock = fn ?? (() => new Date());
}

export const now = () => clock();
export const nowIso = () => now().toISOString();

/** Fecha de calendario YYYY-MM-DD en la zona horaria indicada. */
export function today(timeZone = 'America/Mexico_City') {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now());
}

/** Suma días a una fecha YYYY-MM-DD (aritmética en UTC, sin efectos de DST). */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Días entre dos fechas YYYY-MM-DD (b - a). */
export function diffDays(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export const isWeekend = (date) => [0, 6].includes(weekday(date));
