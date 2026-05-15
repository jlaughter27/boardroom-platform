/**
 * Workspace-root ESLint flat config.
 *
 * Wave 3 Track G (2026-05-15): introduces a guardrail layer so the corrupted
 * Tailwind class strings ("border-borderrounded-lg") and phantom tokens
 * ("bg-text-tertiary") that Wave 2 had to sweep can never ship again.
 *
 * Scope: react/JSX TS files under `packages/boardroom-ai/client/src/**` get
 * the Tailwind + React + custom-rule treatment. Server TS files get a slim
 * baseline (typescript-eslint recommended, no React). Generated / built
 * output is ignored.
 *
 * Prettier: `eslint-config-prettier` is applied last so it strips any
 * stylistic rules that would fight `prettier --check`. We deliberately do
 * NOT enable formatting rules in ESLint.
 */

'use strict';

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const tailwind = require('eslint-plugin-tailwindcss');
const prettier = require('eslint-config-prettier');
const globals = require('globals');
const boardroomRules = require('./eslint-rules');

// NOTE: eslint-plugin-tailwindcss v3 uses a require()-based loader and can't
// evaluate our client tailwind.config.ts (it uses ESM `import.meta.url`). We
// deliberately omit the `config` setting so the plugin uses its built-in
// defaults — fine for the two rules we enable (no-contradicting + class
// ordering, both of which rely on Tailwind's known utility shapes more than
// on this codebase's specific theme). The custom `boardroom/no-class-concat`
// rule below is the real Wave-2-regression guardrail.

module.exports = [
  // ---------------------------------------------------------------------
  // Global ignores
  // ---------------------------------------------------------------------
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.next/**',
      '**/*.min.js',
      'packages/omnimind-api/prisma/migrations/**',
      // Keep the local rule + its plugin out of the lint surface so we don't
      // need a separate Node-flavored config block for them.
      'eslint-rules/**',
    ],
  },

  // ---------------------------------------------------------------------
  // Baseline JS recommendations everywhere
  // ---------------------------------------------------------------------
  js.configs.recommended,

  // ---------------------------------------------------------------------
  // TypeScript baseline (no type-aware rules — keeps the run fast and means
  // we don't need a parserOptions.project at this stage).
  // ---------------------------------------------------------------------
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ['**/*.ts', '**/*.tsx'],
  })),

  // ---------------------------------------------------------------------
  // BoardRoom AI client — React + Tailwind + custom no-class-concat rule
  // ---------------------------------------------------------------------
  {
    files: ['packages/boardroom-ai/client/src/**/*.{ts,tsx,js,jsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      tailwindcss: tailwind,
      boardroom: boardroomRules,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    settings: {
      react: { version: 'detect' },
      tailwindcss: {
        callees: ['cn', 'clsx', 'twMerge', 'classNames'],
      },
    },
    rules: {
      // Tailwind plugin — narrow set per Track G spec.
      // `no-contradicting-classname` is the high-signal error; warn for
      // class ordering to avoid a mass-autofix noise PR.
      'tailwindcss/no-contradicting-classname': 'error',
      'tailwindcss/classnames-order': 'warn',

      // Our launch-blocker guardrail.
      'boardroom/no-class-concat': [
        'error',
        {
          phantomClasses: [
            'bg-text-tertiary',
            'border-t-line',
          ],
          autofix: false,
        },
      ],

      // React hygiene — keep light, this is a guardrail config, not a
      // full opinionated style guide.
      'react/jsx-uses-react': 'off', // React 19, new JSX transform
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // We tolerate `any` for now; tightening is a follow-up.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // BoardRoom AI server — TS, Node globals, no Tailwind / React.
  // ---------------------------------------------------------------------
  {
    files: ['packages/boardroom-ai/server/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // OmniMind API and shared package — TS, Node globals.
  // ---------------------------------------------------------------------
  {
    files: ['packages/omnimind-api/src/**/*.ts', 'packages/shared/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Test files — relax a few rules.
  // ---------------------------------------------------------------------
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'boardroom/no-class-concat': 'off',
    },
  },

  // ---------------------------------------------------------------------
  // Prettier last — disables any stylistic rules that would conflict.
  // ---------------------------------------------------------------------
  prettier,
];
