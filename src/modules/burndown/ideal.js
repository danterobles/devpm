import { isWeekend } from '../../lib/dates.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Línea ideal del Burndown (PRD §5.10): el primer día hábil (lunes a viernes) vale `committed`, el
 * último día hábil vale 0 y entre ambos desciende linealmente por día hábil. Los fines de semana
 * repiten el valor previo, los días anteriores al primer hábil valen `committed` y los posteriores al
 * último, 0. Un sprint de un solo día hábil termina en 0.
 * @param {string[]} days fechas YYYY-MM-DD consecutivas
 * @param {number} committed alcance comprometido (puntos o minutos)
 */
export function idealLine(days, committed) {
  const business = days.filter((d) => !isWeekend(d));
  const n = business.length;
  const index = new Map(business.map((d, i) => [d, i]));
  let previous = committed;
  return days.map((day) => {
    if (index.has(day)) {
      const i = index.get(day);
      previous = n === 1 ? 0 : round2(committed * (1 - i / (n - 1)));
    } else if (n > 0 && day > business[n - 1]) {
      previous = 0;
    }
    return previous;
  });
}
