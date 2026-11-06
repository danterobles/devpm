// Copia las librerías de gráficas de node_modules a public/vendor (servidas localmente, sin CDN).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/chart.js/dist/chart.umd.min.js', 'public/vendor/chart.umd.min.js'],
  ['node_modules/frappe-gantt/dist/frappe-gantt.umd.js', 'public/vendor/frappe-gantt.umd.js'],
  ['node_modules/frappe-gantt/dist/frappe-gantt.css', 'public/vendor/frappe-gantt.css'],
];

mkdirSync(join(root, 'public/vendor'), { recursive: true });
for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.warn(`[copy-vendor] no encontrado: ${from} (¿falta npm install?)`);
    continue;
  }
  cpSync(src, join(root, to));
}
console.log('[copy-vendor] librerías copiadas a public/vendor');
