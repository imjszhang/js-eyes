'use strict';

const CANONICAL_REPOSITORY_URL = 'git+https://github.com/imjszhang/js-eyes.git';

const RELEASE_PACKAGES = [
  { name: '@js-eyes/client-sdk', dir: 'packages/client-sdk' },
  { name: 'js-eyes', dir: 'apps/cli' },
];

// OpenClaw remains a separately bundled integration (`@js-eyes/openclaw-plugin`
// workspace) and is intentionally not part of the independently publishable
// core/npm package set above.
module.exports = { CANONICAL_REPOSITORY_URL, RELEASE_PACKAGES };
