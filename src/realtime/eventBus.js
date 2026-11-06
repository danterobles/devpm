import { EventEmitter } from 'node:events';
import { nowIso } from '../lib/dates.js';

/**
 * Bus de eventos de dominio (ARQUITECTURA §4). Los services emiten **después** de confirmar la
 * transacción; el SSE los reenvía a los navegadores. Los eventos son notificaciones («algo cambió»),
 * nunca llevan datos de negocio.
 * @returns {{ emit: (type: string, payload?: object) => object, subscribe: (fn: (event: object) => void) => () => void, listenerCount: () => number }}
 */
export function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // un listener por cliente SSE conectado
  let seq = 0;

  return {
    emit(type, payload = {}) {
      seq += 1;
      const event = { ...payload, id: seq, type, at: nowIso() }; // el payload no pisa id, type ni at
      emitter.emit('domain', event);
      return event;
    },
    /** Se suscribe a todos los eventos; devuelve la función para cancelar la suscripción. */
    subscribe(listener) {
      emitter.on('domain', listener);
      return () => emitter.off('domain', listener);
    },
    listenerCount: () => emitter.listenerCount('domain'),
  };
}
