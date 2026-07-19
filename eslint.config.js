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
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['extensions/chrome/background/background.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: [
      'apps/**/*.js',
      'openclaw-plugin/**/*.mjs',
      'packages/protocol/**/*.js',
      'packages/runtime-paths/**/*.js',
      'packages/config/**/*.js',
      'packages/client-sdk/**/*.js',
      'packages/server-core/**/*.js',
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
      'extensions/**/*.js',
      'src/**/*.js',
      'skills/*/bridges/**/*.js',
      'packages/visual-bridge-kit/bridge/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
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
  {
    files: ['extensions/firefox/background/background.js'],
    languageOptions: {
      globals: {
        EXTENSION_CONFIG: 'readonly',
        ExtensionUtils: 'readonly',
      },
    },
  },
];
