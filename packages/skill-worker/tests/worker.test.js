'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createSkillWorkerBackend } = require('..');

let tempDir;
let backend;
afterEach(async () => {
  if (backend) await backend.dispose();
  backend = null;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('skill worker backend', () => {
  it('executes handlers and brokers browser capabilities in the host', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-worker-'));
    const entryPath = path.join(tempDir, 'entry.js');
    fs.writeFileSync(entryPath, `'use strict';
module.exports = {
  async activate() {
    return { handlers: {
      async external_read(ctx, input) {
        await ctx.browser.connect();
        const tabs = await ctx.browser.getTabs();
        ctx.browser.disconnect();
        return { value: input.value, tabs, serverUrl: ctx.browser.serverUrl, pid: process.pid, token: process.env.JS_EYES_SERVER_TOKEN || null };
      },
    } };
  },
};`);
    const calls = [];
    const runtime = {
      config: Object.freeze({ requestTimeout: 5, serverUrl: 'ws://host-owned' }),
      storage: Object.freeze({ root: path.join(tempDir, 'data') }),
      getBrowser() {
        return {
          async connect() { calls.push('connect'); },
          async getTabs() { calls.push('getTabs'); return [{ id: 1 }]; },
        };
      },
    };
    backend = createSkillWorkerBackend({
      skill: {
        id: '@acme/external', skillDir: tempDir, entryPath,
        descriptor: {
          id: '@acme/external', version: '1.0.0', capabilities: { browser: ['tabs.read'] },
        },
      },
      runtime,
      logger: { info() {}, warn() {}, error() {} },
    });
    await backend.activate();
    const hostPid = process.pid;
    const result = await backend.invoke('external_read', {
      invocationId: 'call-1', toolCallId: 'call-1', skillId: '@acme/external',
      source: 'test', risk: 'read', deadline: Date.now() + 5000,
      capabilities: {
        has(capability) { return capability === 'browser.tabs.read'; },
        require(capability) { assert.equal(capability, 'browser.tabs.read'); },
      },
    }, { value: 42 });
    assert.deepEqual(result.tabs, [{ id: 1 }]);
    assert.deepEqual(calls, ['connect', 'getTabs']);
    assert.equal(result.serverUrl, 'ws://host-owned');
    assert.notEqual(result.pid, hostPid);
    assert.equal(result.token, null);
  });

  it('rejects capabilities omitted by the invoked tool', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-worker-'));
    const entryPath = path.join(tempDir, 'entry.js');
    fs.writeFileSync(entryPath, `'use strict';
module.exports = { handlers: {
  async external_read(ctx) { return ctx.browser.getCookies(); },
} };`);
    backend = createSkillWorkerBackend({
      skill: {
        id: '@acme/external', skillDir: tempDir, entryPath,
        descriptor: {
          id: '@acme/external', version: '1.0.0',
          capabilities: { browser: ['browser.tabs.read', 'browser.cookies.read'] },
        },
      },
      runtime: {
        config: Object.freeze({ requestTimeout: 5, serverUrl: 'ws://host-owned' }),
        storage: Object.freeze({ root: path.join(tempDir, 'data') }),
        getBrowser() { throw new Error('browser must not be reached'); },
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    await backend.activate();
    await assert.rejects(() => backend.invoke('external_read', {
      invocationId: 'call-2', toolCallId: 'call-2', skillId: '@acme/external',
      source: 'test', risk: 'read', deadline: Date.now() + 5000,
      capabilities: {
        has(capability) { return capability === 'browser.tabs.read'; },
        require(capability) {
          const error = new Error(`Capability not granted: ${capability}`);
          error.code = 'SKILL_CAPABILITY_DENIED';
          throw error;
        },
      },
    }, {}), (error) => error.code === 'SKILL_CAPABILITY_DENIED');
  });
});
