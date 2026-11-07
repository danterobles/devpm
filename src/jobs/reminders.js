import { now } from '../lib/dates.js';
import { msUntilNext } from './burndownSnapshot.js';

/**
 * Job diario de avisos (ARQUITECTURA §3.7): corre al arrancar y todos los días a las 09:00 de la
 * zona de la aplicación. El service es idempotente, así que repetir una ejecución no duplica avisos.
 */
export function createRemindersJob({ reminders, timezone, logger, timers = globalThis }) {
  let handle = null;

  function schedule() {
    handle = timers.setTimeout(run, msUntilNext(now(), timezone, { hour: 9, minute: 0 }));
    handle?.unref?.();
  }

  function run() {
    try {
      const counts = reminders.run();
      logger.info({ counts }, 'Avisos periódicos generados');
    } catch (err) {
      logger.error({ err }, 'Falló la generación de avisos periódicos');
    }
    schedule();
  }

  return {
    start() {
      run();
    },
    stop() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
  };
}
