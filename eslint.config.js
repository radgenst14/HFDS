// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Engine purity boundary (CLAUDE.md rule 4, doc 17 ground rule 3):
 * src/engine/ and src/shared/ never import the client, PixiJS or the DOM, and never
 * use Math.random(), Date.now(), argument-less new Date() or timers.
 * The only exception is src/engine/worker.ts, the Worker host that owns the
 * real-time loop and calls the pure engine's step() (A-35).
 */
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'fetch',
];
const TIMER_GLOBALS = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'performance'];

const restrictedImports = {
  patterns: [
    {
      group: ['**/client', '**/client/**'],
      message: 'engine/ and shared/ must not import client/ (rule 4).',
    },
    {
      group: ['pixi.js', 'pixi.js/*', '@pixi/*'],
      message: 'engine/ and shared/ must not import PixiJS (rule 4).',
    },
    {
      group: ['**/transport', '**/transport/**'],
      message: 'engine/ talks to the page only through worker.ts.',
    },
  ],
};

const restrictedProperties = [
  {
    object: 'Math',
    property: 'random',
    message: 'Use the seeded PRNG in engine/rng.ts (determinism).',
  },
  { object: 'Date', property: 'now', message: 'Use simTime, never wall-clock time (determinism).' },
  {
    object: 'performance',
    property: 'now',
    message: 'Use simTime, never wall-clock time (determinism).',
  },
];

const restrictedSyntax = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'new Date() reads the wall clock; pass an explicit date (determinism).',
  },
];

const msg = (name) => ({ name, message: `${name} is not available in the pure engine (rule 4).` });

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'docs/**',
      'hfds-prototype-kit/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/engine/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      'no-restricted-imports': ['error', restrictedImports],
      'no-restricted-globals': ['error', ...DOM_GLOBALS.map(msg), ...TIMER_GLOBALS.map(msg)],
      'no-restricted-properties': ['error', ...restrictedProperties],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
    },
  },
  {
    // A-35: the Worker host is the single engine file allowed to own real-time timers
    // and to fetch scenario files (doc 15 Part A, "How a scenario loads" step 3).
    files: ['src/engine/worker.ts'],
    rules: {
      'no-restricted-globals': ['error', ...DOM_GLOBALS.filter((g) => g !== 'fetch').map(msg)],
      'no-restricted-imports': [
        'error',
        { patterns: restrictedImports.patterns.filter((p) => !p.group.includes('**/transport')) },
      ],
    },
  },
  prettier,
);
