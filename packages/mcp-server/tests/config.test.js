'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseArgv, resolveConfig } = require('../src/config');

const runtimeConfig = {
  serverHost: '127.0.0.1',
  serverPort: 18080,
  requestTimeout: 45,
};

describe('MCP config', () => {
  it('parses space and equals CLI forms', () => {
    assert.deepEqual(parseArgv([
      '--server-url=ws://localhost:19000',
      '--target', 'ext-1',
      '--tool-profile', 'full',
      '--connect-timeout=4',
    ]), {
      serverUrl: 'ws://localhost:19000',
      target: 'ext-1',
      toolProfile: 'full',
      connectTimeout: '4',
    });
  });

  it('applies CLI over environment over runtime config', () => {
    const config = resolveConfig({
      argv: { serverUrl: 'http://cli.local:1', target: 'cli-target' },
      env: {
        JS_EYES_MCP_SERVER_URL: 'ws://env.local:2',
        JS_EYES_MCP_TARGET: 'env-target',
        JS_EYES_MCP_TOOL_PROFILE: 'full',
      },
      runtimeConfig,
    });
    assert.equal(config.serverUrl, 'ws://cli.local:1');
    assert.equal(config.target, 'cli-target');
    assert.equal(config.toolProfile, 'full');
    assert.equal(config.requestTimeout, 45);
  });

  it('uses safe profile and runtime server by default', () => {
    const config = resolveConfig({ argv: {}, env: {}, runtimeConfig });
    assert.equal(config.serverUrl, 'ws://127.0.0.1:18080');
    assert.equal(config.toolProfile, 'safe');
  });

  it('rejects invalid profiles and unknown options', () => {
    assert.throws(
      () => resolveConfig({ argv: { toolProfile: 'unsafe' }, env: {}, runtimeConfig }),
      /tool profile/,
    );
    assert.throws(() => parseArgv(['--wat']), /unknown option/);
  });
});
