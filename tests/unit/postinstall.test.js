import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// RNF-10: `npm install && npm run db:migrate && npm start` debe dejar la aplicación con estilos y
// librerías locales sin pasos manuales: el `postinstall` copia las librerías y compila el CSS.
const root = new URL('../..', import.meta.url).pathname;
const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('postinstall usa scripts/postinstall.js (copia librerías y compila el CSS)', () => {
  assert.equal(pkg.scripts.postinstall, 'node scripts/postinstall.js');
});

test('postinstall deja public/vendor y public/css/output.css listos', () => {
  fs.rmSync(`${root}public/css/output.css`, { force: true });
  const res = spawnSync(process.execPath, ['scripts/postinstall.js'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  for (const file of [
    'vendor/chart.umd.min.js',
    'vendor/frappe-gantt.umd.js',
    'vendor/frappe-gantt.css',
    'css/output.css',
  ]) {
    assert.ok(fs.existsSync(`${root}public/${file}`), file);
  }
  assert.match(fs.readFileSync(`${root}public/css/output.css`, 'utf8'), /\.overflow-x-auto/);
});

test('sin Tailwind instalado (--omit=dev) no falla: avisa que falta compilar el CSS', () => {
  const res = spawnSync(process.execPath, ['scripts/postinstall.js'], {
    cwd: root,
    env: { ...process.env, DEVPM_TEST_NO_TAILWIND: '1' },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /build:css/);
});
