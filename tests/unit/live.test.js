import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

// Cliente SSE (public/js/lib/live.js): se ejecuta en un entorno simulado (sin navegador).
const source = fs.readFileSync(new URL('../../public/js/lib/live.js', import.meta.url), 'utf8');

function makeEnv({ attrs = {}, now = new Date('2026-05-13T15:04:05') } = {}) {
  const timers = [];
  const dispatched = [];
  const listeners = {};
  const status = { textContent: '', dataset: {} };
  const host = {
    dataset: attrs,
    querySelector: (sel) => (sel === '[data-live-status]' ? status : null),
  };
  class FakeEventSource {
    static instances = [];
    constructor(url) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.handlers = {};
      this.closed = false;
      FakeEventSource.instances.push(this);
    }
    addEventListener(type, fn) {
      (this.handlers[type] ??= []).push(fn);
    }
    close() {
      this.closed = true;
      this.readyState = 2;
    }
    emit(type, data = {}) {
      for (const fn of this.handlers[type] ?? []) fn({ data: JSON.stringify({ type, ...data }) });
    }
    open() {
      this.readyState = 1;
      for (const fn of this.handlers.open ?? []) fn({});
    }
    fail(readyState = 0) {
      this.readyState = readyState;
      for (const fn of this.handlers.error ?? []) fn({});
    }
  }
  const document = {
    querySelector: (sel) => (sel === '[data-live]' ? host : null),
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    dispatchEvent: (event) => {
      dispatched.push(event);
      for (const fn of listeners[event.type] ?? []) fn(event);
    },
    readyState: 'complete',
  };
  const context = {
    document,
    window: { addEventListener: () => {}, location: { search: '' } },
    EventSource: FakeEventSource,
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cancelled = true;
    },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  const fire = () => {
    const pending = timers.filter((t) => !t.cancelled && !t.fired);
    pending.forEach((t) => {
      t.fired = true;
      t.fn();
    });
  };
  return {
    context,
    FakeEventSource,
    status,
    dispatched,
    timers,
    listeners,
    document,
    fire,
    es: () => FakeEventSource.instances.at(-1),
  };
}

test('se conecta a /api/v1/events y muestra el estado «En vivo» al abrir', () => {
  const env = makeEnv({ attrs: {} });
  assert.equal(env.es().url, '/api/v1/events');
  assert.match(env.status.textContent, /Conectando/);
  env.es().open();
  assert.match(env.status.textContent, /En vivo/);
});

test('filtra por proyecto cuando el contenedor lo indica', () => {
  const env = makeEnv({ attrs: { liveProject: '12' } });
  assert.equal(env.es().url, '/api/v1/events?projectId=12');
});

test('debounce: varias notificaciones seguidas producen un solo refresco tras 500 ms', () => {
  const env = makeEnv({ attrs: {} });
  env.es().open();
  env.es().emit('task.updated', { projectId: 1 });
  env.es().emit('task.status_changed', { projectId: 1 });
  env.es().emit('time_entry.changed', { projectId: 1 });
  assert.equal(env.dispatched.filter((e) => e.type === 'devpm:refresh').length, 0); // aún no
  const debounce = env.timers.filter((t) => !t.cancelled && t.ms === 500);
  assert.equal(debounce.length, 1); // los anteriores se cancelaron
  env.fire();
  const refreshes = env.dispatched.filter((e) => e.type === 'devpm:refresh');
  assert.equal(refreshes.length, 1);
  assert.deepEqual([...refreshes[0].detail.types].sort(), [
    'task.status_changed',
    'task.updated',
    'time_entry.changed',
  ]);
});

test('data-live-types limita los refrescos a los prefijos indicados', () => {
  const env = makeEnv({ attrs: { liveTypes: 'task.,sprint.' } });
  env.es().open();
  env.es().emit('time_entry.changed');
  env.es().emit('settings.updated');
  env.fire();
  assert.equal(env.dispatched.filter((e) => e.type === 'devpm:refresh').length, 0);
  env.es().emit('sprint.closed');
  env.fire();
  assert.equal(env.dispatched.filter((e) => e.type === 'devpm:refresh').length, 1);
});

test('el debounce es configurable', () => {
  const env = makeEnv({ attrs: { liveDebounce: '200' } });
  env.es().open();
  env.es().emit('task.updated');
  assert.ok(env.timers.some((t) => t.ms === 200 && !t.cancelled));
});

test('indicador de conexión: reconectando en errores transitorios y sin conexión si el navegador desiste', () => {
  const env = makeEnv({ attrs: {} });
  env.es().open();
  env.es().fail(0); // EventSource reintentará solo
  assert.match(env.status.textContent, /Reconectando/);
  env.es().fail(2); // cerrado definitivamente (p. ej. sesión vencida)
  assert.match(env.status.textContent, /Sin conexión/);
});

test('al reconectarse pide un refresco para recuperar lo que se perdió', () => {
  const env = makeEnv({ attrs: {} });
  env.es().open(); // primera conexión: sin refresco extra
  env.fire();
  assert.equal(env.dispatched.filter((e) => e.type === 'devpm:refresh').length, 0);
  env.es().fail(0);
  env.es().open();
  env.fire();
  assert.equal(env.dispatched.filter((e) => e.type === 'devpm:refresh').length, 1);
});

test('devpm:loaded registra la hora de la última actualización en el indicador', () => {
  const env = makeEnv({ attrs: {}, now: new Date('2026-05-13T15:04:05') });
  env.es().open();
  env.document.dispatchEvent(
    new env.context.CustomEvent('devpm:loaded', { detail: { at: new env.context.Date() } }),
  );
  assert.match(env.status.textContent, /En vivo/);
  assert.match(env.status.textContent, /Última actualización: 15:04:05/);
});

test('sin contenedor [data-live] no hace nada', () => {
  const env = makeEnv();
  // un documento sin host: no debe conectar
  const FakeES = env.FakeEventSource;
  const before = FakeES.instances.length;
  const context = { ...env.context, document: { ...env.document, querySelector: () => null } };
  vm.createContext(context);
  vm.runInContext(source, context);
  assert.equal(FakeES.instances.length, before);
});

test('escucha todos los tipos de evento conocidos y cierra la conexión al abandonar la página', () => {
  const env = makeEnv({ attrs: {} });
  const types = Object.keys(env.es().handlers);
  for (const t of [
    'task.created',
    'task.updated',
    'task.status_changed',
    'task.deleted',
    'project.updated',
    'sprint.started',
    'time_entry.approved',
    'assignment.changed',
    'milestone.updated',
    'client.updated',
    'settings.updated',
    'team_member.updated',
    'time_off.changed',
  ]) {
    assert.ok(types.includes(t), t);
  }
  assert.equal(typeof env.context.DevPMLive?.close, 'function');
  env.context.DevPMLive.close();
  assert.equal(env.es().closed, true);
});
