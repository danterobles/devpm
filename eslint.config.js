import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/',
      'public/vendor/',
      'public/css/',
      'data/',
      'coverage/',
      '.playwright-mcp/',
    ],
  },
  // Guiones de captura de los manuales: fragmentos para ejecutar en el navegador, no módulos (RF-183)
  { ignores: ['docs/manuales/fuente/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
