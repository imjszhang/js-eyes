'use strict';

const CANONICAL_REPOSITORY_URL = 'git+https://github.com/imjszhang/js-eyes.git';

const RELEASE_PACKAGES = [
  { name: '@js-eyes/skill-contract', dir: 'packages/skill-contract' },
  { name: '@js-eyes/protocol', dir: 'packages/protocol' },
  { name: '@js-eyes/runtime-paths', dir: 'packages/runtime-paths' },
  { name: '@js-eyes/config', dir: 'packages/config' },
  { name: '@js-eyes/skill-recording', dir: 'packages/skill-recording' },
  { name: '@js-eyes/client-sdk', dir: 'packages/client-sdk' },
  { name: '@js-eyes/skill-worker', dir: 'packages/skill-worker' },
  { name: '@js-eyes/skill-runtime', dir: 'packages/skill-runtime' },
  { name: '@js-eyes/server-core', dir: 'packages/server-core' },
  { name: '@js-eyes/mcp-server', dir: 'packages/mcp-server' },
  { name: '@js-eyes/native-host', dir: 'apps/native-host' },
  { name: 'js-eyes', dir: 'apps/cli' },
];

// OpenClaw remains a separately bundled integration and is intentionally not
// a dependency of the independently publishable core/npm package set.
module.exports = { CANONICAL_REPOSITORY_URL, RELEASE_PACKAGES };
