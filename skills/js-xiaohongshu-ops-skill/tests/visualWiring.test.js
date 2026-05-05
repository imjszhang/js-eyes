'use strict';

/**
 * v3.1 PR-V6: 验证 cli → runTool 的 visual 串联。
 * 通过 require.cache 注入 mock 的 lib/runTool，断言 cli 在 --visual 时把
 * { visualConfig, visualTrace, visualRecord } 透传到 runTool.options。
 *
 * 不实际连浏览器，只验证参数路由。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

function requireFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function withMockedRunTool(fn) {
  const runToolPath = require.resolve('../lib/runTool');
  const browserPath = require.resolve('../lib/js-eyes-client');
  const sessionPath = require.resolve('../lib/session');

  const realRunTool = require.cache[runToolPath];
  const realBrowser = require.cache[browserPath];
  const realSession = require.cache[sessionPath];

  const captured = { calls: [] };
  const fakeRunToolModule = {
    id: runToolPath,
    filename: runToolPath,
    loaded: true,
    exports: {
      runTool: async (browser, spec) => {
        captured.calls.push(spec);
        return { ok: true, run: { id: 'fake-run', durationMs: 1, paths: null }, result: {}, visual: spec.options && spec.options.visualConfig ? { enabled: true, eventsCount: 0, events: [], hint: { toolName: spec.toolName }, recordDir: null, traceFile: null, framesEnabled: false } : null };
      },
      buildTryOrder: () => [],
      normalizeReadMode: (m) => m || 'auto',
      FALLBACK_ERRORS: new Set(),
    },
    children: [],
    parent: null,
    paths: realRunTool ? realRunTool.paths : [],
  };
  require.cache[runToolPath] = fakeRunToolModule;

  // 同样 mock BrowserAutomation 与 Session（不连真浏览器）
  const fakeBrowser = {
    exports: {
      BrowserAutomation: class FakeBrowser {
        constructor() {}
        async connect() {}
        disconnect() {}
        async getTabs() { return { tabs: [] }; }
        async openUrl() {}
      },
    },
    id: browserPath, filename: browserPath, loaded: true, children: [], parent: null,
    paths: realBrowser ? realBrowser.paths : [],
  };
  require.cache[browserPath] = fakeBrowser;

  const fakeSession = {
    exports: {
      Session: class FakeSession {
        constructor() {}
        async connect() {}
        async resolveTarget() {}
        async ensureBridge() { return { version: '0.0.0' }; }
        async callApi() { return { ok: true, data: {} }; }
        async close() {}
      },
      pickTabMatchingProfile: () => null,
      expandBridgeSource: (s) => s,
      urlsEquivalent: () => false,
    },
    id: sessionPath, filename: sessionPath, loaded: true, children: [], parent: null,
    paths: realSession ? realSession.paths : [],
  };
  require.cache[sessionPath] = fakeSession;

  // 强制 cli 重新解析（cli 顶层 require 了 runTool / Session / BrowserAutomation）
  const cliPath = require.resolve('../cli/index.js');
  delete require.cache[cliPath];
  const cli = require(cliPath);

  return fn(captured, cli).finally(() => {
    if (realRunTool) require.cache[runToolPath] = realRunTool; else delete require.cache[runToolPath];
    if (realBrowser) require.cache[browserPath] = realBrowser; else delete require.cache[browserPath];
    if (realSession) require.cache[sessionPath] = realSession; else delete require.cache[sessionPath];
    delete require.cache[cliPath];
  });
}

test('cli: --visual --visual-hud --visual-flash → runTool.options.visualConfig 真有内容', async () => {
  await withMockedRunTool(async (captured, cli) => {
    // 拦截 stdout/stderr，避免污染测试输出
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
      await cli.dispatch(['note', 'https://www.xiaohongshu.com/explore/abc123', '--visual', '--visual-hud', '--visual-flash']);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    assert.strictEqual(captured.calls.length, 1, 'runTool 应被调用一次');
    const opts = captured.calls[0].options;
    assert.ok(opts.visualConfig, 'visualConfig 缺失');
    assert.strictEqual(opts.visualConfig.enabled, true);
    assert.strictEqual(opts.visualConfig.hud, true);
    assert.strictEqual(opts.visualConfig.flash, true);
  });
});

test('cli: 默认开启 visual（与 x-ops-skill 对齐）；--no-visual 关闭', async () => {
  await withMockedRunTool(async (captured, cli) => {
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
      await cli.dispatch(['note', 'https://www.xiaohongshu.com/explore/abc123']);
      await cli.dispatch(['note', 'https://www.xiaohongshu.com/explore/abc123', '--no-visual']);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    assert.strictEqual(captured.calls.length, 2);
    assert.ok(captured.calls[0].options.visualConfig, '默认 CLI 调用应启用 visual');
    assert.strictEqual(captured.calls[1].options.visualConfig, undefined, '--no-visual 时关闭 visual');
  });
});

test('cli: --visual-trace=./trace.jsonl → options.visualTrace 透传字符串（runTool 内部 resolve）', async () => {
  await withMockedRunTool(async (captured, cli) => {
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
      await cli.dispatch(['note', 'https://www.xiaohongshu.com/explore/abc123', '--visual', '--visual-trace=./tmp-trace.jsonl']);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    assert.strictEqual(captured.calls.length, 1);
    const opts = captured.calls[0].options;
    assert.ok(opts.visualTrace, 'visualTrace 应非空');
    assert.match(opts.visualTrace, /tmp-trace\.jsonl$/);
  });
});

test('runTool 模块顶层硬依赖 visual-bridge-kit（不再 lazy）', () => {
  // 验收：runTool.js 加载时不应抛错（kit 已被根 npm i 安装）。
  const fresh = requireFresh('../lib/runTool');
  assert.ok(typeof fresh.runTool === 'function');
});
