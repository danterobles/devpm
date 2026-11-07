// Se ejecuta tras `npm install` (RNF-10): copia las librerías de gráficas a public/vendor y compila el
// CSS de Tailwind, para que `npm run db:migrate && npm start` deje la aplicación lista sin más pasos.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const vendor = spawnSync(process.execPath, [join(root, 'scripts/copy-vendor.js')], {
  stdio: 'inherit',
});
if (vendor.status !== 0) process.exit(vendor.status ?? 1);

// Con `npm install --omit=dev` no existe Tailwind (es una dependencia de desarrollo).
const hasTailwind =
  !process.env.DEVPM_TEST_NO_TAILWIND && existsSync(join(root, 'node_modules/@tailwindcss/cli'));
if (!hasTailwind) {
  console.log(
    '[postinstall] Tailwind no está instalado: compila el CSS con `npm run build:css` en un entorno con dependencias de desarrollo.',
  );
} else {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const css = spawnSync(npm, ['run', 'build:css'], { cwd: root, stdio: 'inherit' });
  if (css.status !== 0) process.exit(css.status ?? 1);
}
