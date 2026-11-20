// Minimal, high-signal lint pass. Deliberately NOT the recommended
// preset stacks — svelte-check already covers types and template
// validity, so this config only enforces the few hygiene rules that
// have actually bitten this repo:
//   - no-console:  debug logs leaking into release (25 removed 2026-07)
//   - no-empty:    bare `catch {}` hiding real failures — a comment
//                  inside the block satisfies the rule, so intentional
//                  swallows stay legal as long as they say why
//   - no-unused-vars: dead code creep in big Svelte files
// Broaden gradually if a new failure class shows up; don't bulk-enable
// preset rules that would bury these in noise.
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default [
  {
    ignores: [
      'build/',
      '.svelte-kit/',
      'node_modules/',
      'static/vendor/',
      'src-tauri/target/',
      'mobile-typewriter/', // separate package with its own config
      'stats-sync/',
      'tailwindcss/'
    ]
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
    // Build scripts run under plain node and print by design.
    files: ['scripts/**', '*.config.{js,cjs}', 'svelte.config.js', 'vite.config.js'],
    rules: { 'no-console': 'off' }
  }
];
