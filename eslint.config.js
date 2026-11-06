import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'public/vendor/', 'public/css/', 'data/', 'coverage/'] },
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
