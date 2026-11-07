import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// RNF-07: contraste AA (4,5:1 en texto normal, 3:1 en texto grande). Se calcula con la fórmula de WCAG
// a partir de los tokens de `src/styles/input.css` y de la paleta de Tailwind usada en las vistas.
const css = fs.readFileSync(new URL('../../src/styles/input.css', import.meta.url), 'utf8');

/** oklch(L C h) → sRGB 0–255 (conversión estándar de OKLab). */
function oklchToRgb(l, c, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  });
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const token = (name) => {
  const h = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (h) return hex(h[1]);
  const m = new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(
    css,
  );
  assert.ok(m, `token ${name}`);
  return oklchToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
};

const WHITE = [255, 255, 255];
const SLATE_50 = hex('#f8fafc');
const PAIRS = [
  ['texto blanco sobre botón brand-600 (bg-brand-600 text-white)', WHITE, token('brand-600')],
  ['texto blanco sobre encabezado brand-700', WHITE, token('brand-700')],
  [
    'botón activo del Gantt/escala (aria-pressed: bg-brand-600 text-white)',
    WHITE,
    token('brand-600'),
  ],
  ['texto slate-800 sobre el fondo de la página', hex('#1e293b'), SLATE_50],
  ['texto slate-600 (secundario) sobre blanco', hex('#475569'), WHITE],
  ['texto slate-600 (secundario) sobre el fondo de la página', hex('#475569'), SLATE_50],
  ['texto slate-500 sobre blanco', hex('#64748b'), WHITE],
  ['texto slate-500 sobre el fondo de la página', hex('#64748b'), SLATE_50],
  ['error: red-800 sobre red-50', hex('#991b1b'), hex('#fef2f2')],
  ['alerta: amber-900 sobre amber-50', hex('#78350f'), hex('#fffbeb')],
  ['éxito: green-800 sobre green-50', hex('#166534'), hex('#f0fdf4')],
  ['texto rojo de énfasis (text-red-700) sobre blanco', hex('#b91c1c'), WHITE],
  ['semáforo verde en tarjetas: green-900 sobre green-50', hex('#14532d'), hex('#f0fdf4')],
  ['semáforo ámbar en tarjetas: amber-900 sobre amber-50', hex('#78350f'), hex('#fffbeb')],
  ['semáforo rojo en tarjetas: red-900 sobre red-50', hex('#7f1d1d'), hex('#fef2f2')],
  // Rediseño D (RNF-12), modo claro: tarjetas de KPI y encabezado azul marino
  ['tarjeta: etiqueta navy-600 sobre blanco', token('navy-600'), WHITE],
  ['tarjeta: semáforo verde (emerald-800) sobre blanco', hex('#065f46'), WHITE],
  ['tarjeta: semáforo ámbar (amber-800) sobre blanco', hex('#92400e'), WHITE],
  ['tarjeta: semáforo rojo (rose-700) sobre blanco', hex('#be123c'), WHITE],
  ['encabezado: texto blanco sobre navy-900', WHITE, token('navy-900')],
  ['encabezado: navy-200 sobre navy-900', token('navy-200'), token('navy-900')],
  ['selector de tema activo: navy-900 sobre blanco', token('navy-900'), WHITE],
  ['botón Aplicar: blanco sobre navy-800', WHITE, token('navy-800')],
  // Modo oscuro: tokens redefinidos en input.css y colores de las tarjetas
  ['oscuro: texto navy-50 sobre navy-950', token('navy-50'), token('navy-950')],
  ['oscuro: texto secundario navy-300 sobre navy-900', token('navy-300'), token('navy-900')],
  ['oscuro: texto secundario navy-300 sobre navy-950', token('navy-300'), token('navy-950')],
  ['oscuro: navy-200 sobre navy-900', token('navy-200'), token('navy-900')],
  ['oscuro: semáforo verde (emerald-300) sobre navy-900', hex('#6ee7b7'), token('navy-900')],
  ['oscuro: semáforo ámbar (amber-300) sobre navy-900', hex('#fcd34d'), token('navy-900')],
  ['oscuro: semáforo rojo (rose-300) sobre navy-900', hex('#fda4af'), token('navy-900')],
  ['oscuro: error (red-800 redefinido) sobre red-50 redefinido', hex('#fecdd3'), hex('#3a1420')],
  [
    'oscuro: éxito (green-800 redefinido) sobre green-50 redefinido',
    hex('#a7f3d0'),
    hex('#0f2d22'),
  ],
  [
    'oscuro: alerta (amber-900 redefinido) sobre amber-50 redefinido',
    hex('#fde68a'),
    hex('#33260b'),
  ],
  ['oscuro: botón Aplicar, navy-950 sobre sky-400', token('navy-950'), hex('#38bdf8')],
  // Gantt en oscuro: texto de fechas y de tareas sobre el encabezado y las filas
  [
    'oscuro Gantt: texto atenuado (navy-200) sobre el encabezado navy-950',
    token('navy-200'),
    token('navy-950'),
  ],
  ['oscuro Gantt: texto (navy-50) sobre las filas navy-900', token('navy-50'), token('navy-900')],
  [
    'oscuro Gantt: etiqueta de fin de semana (navy-300) sobre navy-950',
    token('navy-300'),
    token('navy-950'),
  ],
];

for (const [label, fg, bg] of PAIRS) {
  test(`contraste AA: ${label}`, () => {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1 < 4.5:1`);
  });
}

test('el token «danger» sirve para bordes (3:1) pero no para texto: las vistas no lo usan como color de texto', () => {
  assert.ok(
    contrast(token('danger'), WHITE) < 4.5,
    'si algún día el token cumple AA este test se puede relajar',
  );
  assert.ok(contrast(token('danger'), WHITE) >= 3, 'como borde de componente debe llegar a 3:1');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.(ejs|js)$/.test(entry.name) &&
        /(^|[\s'"`:])text-(danger|warn|ok)\b/.test(fs.readFileSync(full, 'utf8'))
      )
        offenders.push(full);
    }
  };
  walk(new URL('../../src/views', import.meta.url).pathname);
  walk(new URL('../../public/js', import.meta.url).pathname);
  assert.deepEqual(
    offenders,
    [],
    'usa text-red-700 (u otro color con 4,5:1) en lugar de text-danger/warn/ok',
  );
});

test('los textos de fecha del Gantt (librería) se oscurecen para llegar a AA', () => {
  const m = /--g-text-muted:\s*(#[0-9a-fA-F]{6})/.exec(css);
  assert.ok(m, 'input.css redefine --g-text-muted del Gantt');
  assert.ok(contrast(hex(m[1]), WHITE) >= 4.5);
});

test('hay un indicador de foco visible global (navegación con teclado)', () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline/);
});

test('las tablas con scroll horizontal contienen a los textos sr-only (si no, la página se desborda en móvil)', () => {
  assert.match(css, /\.overflow-x-auto\s*\{[^}]*position:\s*relative/);
});

test('el botón de ajuste del Gantt se lee (texto oscuro sobre su fondo gris claro)', () => {
  assert.match(
    css,
    /\.gantt-container \.extras button\.adjust\s*\{[^}]*color:\s*var\(--g-text-dark\)/,
  );
});

test('los campos de formulario no superan el ancho de su contenedor (móvil)', () => {
  assert.match(css, /select,\s*input,\s*textarea\s*\{[^}]*max-width:\s*100%/);
});

test('el CSS define el modo oscuro que sigue al sistema y puede forzarse con data-theme', () => {
  assert.match(css, /@custom-variant dark/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /data-theme='light'/);
});

test('el Gantt redefine sus variables --g-* en modo oscuro (la librería solo conoce html[data-theme=dark])', () => {
  const block = /\.gantt-container\s*\{\s*@variant dark\s*\{([^}]*)\}/.exec(css);
  assert.ok(block, 'input.css define las variables del Gantt bajo @variant dark');
  for (const name of [
    'header-background',
    'row-color',
    'text-dark',
    'text-muted',
    'border-color',
    'arrow-color',
  ])
    assert.match(block[1], new RegExp(`--g-${name}:`), name);
});
