import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeChanges } from '../../src/modules/audit/audit.service.js';

// Presentación legible de los cambios de la bitácora (RF-170).
test('describeChanges: «campo: antes → después», nulos como «—» y secretos ocultos', () => {
  assert.deepEqual(
    describeChanges(
      '{"name":["a","b"],"notes":[null,""],"password":[null,"(cambiada)"],"totp_secret":["x","y"],"api_token":["1","2"]}',
    ),
    [
      { field: 'name', before: 'a', after: 'b' },
      { field: 'notes', before: '—', after: '—' },
      { field: 'password', before: '(oculto)', after: '(oculto)' },
      { field: 'totp_secret', before: '(oculto)', after: '(oculto)' },
      { field: 'api_token', before: '(oculto)', after: '(oculto)' },
    ],
  );
});

test('describeChanges: tolera JSON inválido, nulo o con valores que no son pares', () => {
  assert.deepEqual(describeChanges('no es json'), []);
  assert.deepEqual(describeChanges(null), []);
  assert.deepEqual(describeChanges('"texto"'), []);
  assert.deepEqual(describeChanges('{"x":5}'), [{ field: 'x', before: '—', after: '5' }]);
});
