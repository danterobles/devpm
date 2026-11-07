import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// El README es parte del producto (RNF-10): sus comandos y variables deben existir de verdad.
const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));
const configSource = read('src/config/index.js');

test('el README existe y cubre instalación, uso, despliegue y respaldos', () => {
  for (const heading of [
    '## Instalación',
    '## Desarrollo',
    '## Variables de entorno',
    '## Despliegue',
    '## Respaldos',
    '## Pruebas',
    '## Documentación',
  ]) {
    assert.ok(readme.includes(heading), `falta la sección «${heading}»`);
  }
});

test('todo `npm run <script>` / `npm <script>` citado en el README existe en package.json', () => {
  const cited = new Set([...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]));
  for (const simple of ['start', 'test', 'install'])
    if (new RegExp(`npm ${simple}\\b`).test(readme)) cited.add(simple);
  assert.ok(cited.size >= 8);
  for (const script of cited) {
    if (script === 'install') continue;
    assert.ok(pkg.scripts[script], `npm run ${script} no existe en package.json`);
  }
});

test('el README documenta todos los scripts de package.json (salvo los internos)', () => {
  const internal = new Set(['postinstall', 'watch:css']);
  for (const script of Object.keys(pkg.scripts).filter((s) => !internal.has(s))) {
    assert.ok(
      readme.includes(`npm run ${script}`) || readme.includes(`npm ${script}`),
      `el script ${script} no está documentado`,
    );
  }
});

test('el README documenta todas las variables de entorno de la configuración', () => {
  const variables = [...configSource.matchAll(/^\s{2}([A-Z][A-Z_]+):\s*z\./gm)].map((m) => m[1]);
  assert.ok(variables.length >= 9, `variables detectadas: ${variables.join(', ')}`);
  for (const name of variables)
    assert.ok(readme.includes(`\`${name}\``), `falta documentar ${name}`);
});

test('los usuarios de ejemplo del README coinciden con el seed y se avisa que son solo de desarrollo', () => {
  const seed = read('src/db/seeds/dev.js');
  for (const email of [...readme.matchAll(/([\w.]+@devpm\.local)/g)].map((m) => m[1])) {
    assert.ok(seed.includes(email), `${email} no existe en el seed`);
  }
  assert.match(readme, /solo (para )?desarrollo/i);
  assert.match(readme, /HTTPS/);
  assert.match(readme, /X-Forwarded-Proto/);
});

test('.env.example contiene todas las variables documentadas', () => {
  const example = read('.env.example');
  for (const name of [...configSource.matchAll(/^\s{2}([A-Z][A-Z_]+):\s*z\./gm)].map((m) => m[1])) {
    assert.ok(example.includes(`${name}=`), `${name} falta en .env.example`);
  }
});
