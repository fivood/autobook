// Mirror of the desktop package's minimal lint config — same rationale
// (svelte-check owns types; lint only enforces repo-proven hygiene
// rules). Keep the two configs in sync when adding rules.
import ts from 'typescript-eslint';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default [
  {
    ignores: ['build/', '.svelte-kit/', 'node_modules/', 'static/vendor/']
  },
  {
    files: ['**/*.{js,ts,svelte}'],
    languageOptions: {
      parser: ts.parser,
      parserOptions: { extraFileExtensions: ['.svelte'] },
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: { '@typescript-eslint': ts.plugin },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',
      'no-empty': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ]
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: ts.parser }
    }
  },
  {
    files: ['scripts/**', '*.config.{js,cjs}', 'svelte.config.js', 'vite.config.ts'],
    rules: { 'no-console': 'off' }
  }
];
