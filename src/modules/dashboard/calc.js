import { addDays, diffDays, isWeekend, weekday } from '../../lib/dates.js';

/** División segura: `null` si falta algún dato o el denominador es 0. */
export function ratio(numerator, denominator) {
  if (numerator === null || numerator === undefined || !denominator) return null;
  return numerator / denominator;
}

export const round1 = (value) =>
  value === null || value === undefined ? null : Math.round(value * 10) / 10;

/** Fracción (0 a 1) del plan transcurrida a `today`; un plan de un solo día vale 1 desde ese día. */
export function elapsedFraction(startDate, endDate, today) {
  if (today < startDate) return 0;
  if (today >= endDate) return 1;
  return diffDays(startDate, today) / diffDays(startDate, endDate);
}

/** Días hábiles (lunes a viernes) del rango inclusivo. */
export function businessDays(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d)) days.push(d);
  return days;
}

/** Lunes a domingo de la semana que contiene `date`. */
export function weekRange(date) {
  const from = addDays(date, -((weekday(date) + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** Los últimos `n` días terminando en `today` (inclusivo). */
export function lastDays(today, n) {
  return { from: addDays(today, -(n - 1)), to: today };
}
