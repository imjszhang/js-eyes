'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SkillCapabilityError,
  SkillDisposedError,
  SkillTimeoutError,
  createSkillRuntime,
} = require('..');
const { createLegacyRuntime } = require('../legacy-entry');

let tempDir;
afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function makeRuntime(options = {}) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-runtime-'));
  return createSkillRuntime({
    descriptor: { id: '@acme/example', version: '1.0.0' },
    configLoader: () => ({ serverHost: '127.0.0.1', serverPort: 18080, recording: { mode: 'off' } }),
    runtimePaths: { baseDir: tempDir },
    logger: { info() {}, warn() {}, error() {} },
    ...options,
  });
}

describe('skill runtime', () => {
  it('preserves official legacy runtime config defaults while injecting the host browser', () => {
    const browser = { hostOwned: true };
    const context = {
      config: { raw: true },
      logger: { info() {}, warn() {}, error() {} },
      browser,
    };
    const bridged = createLegacyRuntime(context, (config) => ({
      config: { ...config, defaulted: 42 },
      ensureBot() { throw new Error('legacy browser must not be constructed'); },
    }));
    assert.deepEqual(bridged.config, { raw: true, defaulted: 42 });
    assert.strictEqual(bridged.ensureBot(), browser);
  });

  it('creates and finishes per-call invocation contexts', async () => {
    const runtime = makeRuntime({ grantedCapabilities: ['browser.page.read'] });
    const result = await runtime.invoke({
      name: 'example_read',
      risk: 'read',
      async execute(ctx, input) {
        assert.equal(ctx.skillId, '@acme/example');
        assert.equal(ctx.toolCallId, 'call-1');
        assert.equal(ctx.capabilities.has('browser.page.read'), true);
        return { value: input.value };
      },
    }, { value: 42 }, { toolCallId: 'call-1', source: 'test' });
    assert.deepEqual(result, { value: 42 });
    assert.equal(runtime.activeInvocationCount, 0);
  });

  it('enforces declared grants on injected capabilities', async () => {
    const runtime = makeRuntime();
    assert.throws(() => runtime.requireCapability('browser.cookies.read'), SkillCapabilityError);
  });

  it('brokers browser methods through capability checks', async () => {
    const calls = [];
    const runtime = makeRuntime({
      grantedCapabilities: ['browser.tabs.read'],
      browserFactory: () => ({
        async getTabs() { calls.push('tabs'); return [{ id: 1 }]; },
        async getCookies() { calls.push('cookies'); return []; },
        disconnect() {},
      }),
    });
    const invocation = runtime.createInvocation({ toolName: 'read', input: {} });
    assert.deepEqual(await invocation.browser.getTabs(), [{ id: 1 }]);
    assert.throws(() => invocation.browser.getCookies(), SkillCapabilityError);
    invocation.finish();
    assert.deepEqual(calls, ['tabs']);
    await runtime.dispose();
  });

  it('intersects skill grants with per-tool declared capabilities', async () => {
    const runtime = makeRuntime({
      grantedCapabilities: ['browser.tabs.read', 'browser.cookies.read'],
      browserFactory: () => ({
        async getTabs() { return []; },
        async getCookies() { return []; },
        disconnect() {},
      }),
    });
    await assert.rejects(() => runtime.invoke({
      name: 'tabs_only',
      risk: 'read',
      capabilities: ['browser.tabs.read'],
      async execute(ctx) { return ctx.browser.getCookies(); },
    }, {}), SkillCapabilityError);
    await runtime.dispose();
  });

  it('rejects at the deadline even when a handler ignores cancellation', async () => {
    const runtime = makeRuntime();
    const startedAt = Date.now();
    await assert.rejects(() => runtime.invoke({
      name: 'slow', risk: 'read', capabilities: [],
      async execute() { await new Promise((resolve) => setTimeout(resolve, 100)); },
    }, {}, { timeoutMs: 15 }), SkillTimeoutError);
    assert.ok(Date.now() - startedAt < 80);
    await runtime.dispose();
  });

  it('keeps the physical browser connection lifecycle host-owned', async () => {
    let connected = 0;
    let disconnected = 0;
    const runtime = makeRuntime({
      grantedCapabilities: ['browser.tabs.read'],
      browserFactory: () => ({
        serverUrl: 'ws://test',
        async connect() { connected += 1; },
        disconnect() { disconnected += 1; },
      }),
    });
    const browser = runtime.getScopedBrowser();
    await browser.connect();
    browser.disconnect();
    assert.equal(browser.serverUrl, 'ws://test');
    assert.equal(connected, 1);
    assert.equal(disconnected, 0);
    await runtime.dispose();
    assert.equal(disconnected, 1);
  });

  it('disposes resources in reverse order and is idempotent', async () => {
    const runtime = makeRuntime();
    const calls = [];
    runtime.registerDisposable(() => calls.push('first'));
    runtime.registerDisposable(() => calls.push('second'));
    const first = await runtime.dispose();
    const second = await runtime.dispose();
    assert.deepEqual(calls, ['second', 'first']);
    assert.strictEqual(first, second);
    assert.throws(() => runtime.createInvocation({ toolName: 'late' }), SkillDisposedError);
  });

  it('creates isolated storage paths outside the source tree', () => {
    const runtime = makeRuntime();
    runtime.ensureStorage();
    assert.ok(runtime.storage.root.startsWith(tempDir));
    assert.equal(fs.statSync(runtime.storage.state).isDirectory(), true);
  });
});
