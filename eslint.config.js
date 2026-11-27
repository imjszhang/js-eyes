'use strict';

const js = require('@eslint/js');
const globals = require('globals');

const generatedFiles = [
  '**/node_modules/**',
  'build/**',
  'dist/**',
  'docs/**',
  'runs/**',
  'work_dir/**',
  'packages/visual-replay-hyperframes/__fixtures__/**/composition/**',
];

module.exports = [
  {
    ignores: generatedFiles,
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.es2022,
        ...globals.node,
        ...globals.commonjs,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      ...js.configs.recommended.rules,
      // Existing modules intentionally expose helpers through side effects and
      // generated bridge source. Introduce unused-symbol checks separately.
      'no-unused-vars': 'off',
      // Empty catch blocks are used for best-effort cleanup and compatibility.
      'no-empty': 'off',
      // ESLint 10 recommended adds these; adopt them in a dedicated cleanup.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: [
      'apps/**/*.js',
      'openclaw-plugin/**/*.mjs',
      'packages/client-sdk/**/*.js',
      'packages/devtools/**/*.js',
    ],
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: [
      'packages/client-sdk/protocol/page-interact-core.js',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: [
      'src/**/*.js',
      'skills/*/bridges/**/*.js',
      'packages/visual-bridge-kit/bridge/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['skills/*/bridges/**/*.js'],
    rules: {
      // Bridge fragments are concatenated with their sibling common.js file
      // before execution, so shared bridge symbols are intentionally external.
      'no-undef': 'off',
    },
  },
];
