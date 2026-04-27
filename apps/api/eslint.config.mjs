/**
 * Minimal ESLint flat config for the API.
 *
 * Pinned to ESLint v9 (flat config). Defers to TypeScript's strict mode +
 * `tsc --noEmit` for type-correctness — the rules below are what static
 * type-checking can't catch on its own (style / safety patterns).
 *
 * To add stricter rules later: extend `@typescript-eslint/strict-type-
 * checked` once the typed-linting parser is wired up. Keeping the config
 * lightweight for now so it doesn't block the CI gate on cosmetic findings.
 */

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'prisma/migrations/**',
      'src/**/*.d.ts',
    ],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // Catches stray debug logs in src code (the security-scan job
      // already greps for `console.log` in src/, but eslint catches
      // it in test/ too where the grep doesn't run).
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Forbid `eval` and Function-constructor style code execution.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      // No bare `var` — let const-correctness fall through.
      'no-var': 'error',
      'prefer-const': 'warn',
      // Catch unused vars but allow `_`-prefixed (intentional ignores).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
