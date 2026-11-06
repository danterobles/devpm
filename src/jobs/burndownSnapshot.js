import { now } from '../lib/dates.js';

/**
 * Milisegundos hasta la próxima ejecución diaria (por defecto 23:55) en la zona horaria dada.
 * Si ya pasó (o es exactamente la hora), apunta al día siguiente. Se recalcula en cada ejecución,
 * así que un cambio de horario o un reloj ajustado no acumula desfases.
 */
export function msUntilNext(date, timeZone, { hour = 23, minute = 55 } = {}) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const localNow = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0);
  const delay = target - localNow;
  return delay > 0 ? delay : delay + 24 * 60 * 60 * 1000;
}

/**
 * Job diario del Burndown (ARQUITECTURA §5): al arrancar rellena los días faltantes y captura hoy;
 * después, a las 23:55 de la zona de la aplicación, guarda la instantánea de cada sprint activo.
 * Usa un `setTimeout` recalculado (sin dependencias).
 */
export function createBurndownJob({ snapshots, timezone, logger, timers = globalThis }) {
  let handle = null;

  function schedule() {
    handle = timers.setTimeout(run, msUntilNext(now(), timezone));
    handle?.unref?.(); // no mantiene vivo el proceso
  }

  function run() {
    try {
      const count = snapshots.captureActive();
      logger.info(`Burndown: instantáneas diarias guardadas (${count} sprints activos)`);
    } catch (err) {
      logger.error({ err }, 'Burndown: falló la instantánea diaria');
    }
    schedule();
  }

  return {
    start() {
      try {
        const written = snapshots.backfillActive();
        logger.info(`Burndown: relleno de instantáneas al arrancar (${written} filas)`);
      } catch (err) {
        logger.error({ err }, 'Burndown: falló el relleno al arrancar');
      }
      schedule();
    },
    stop() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
  };
}
