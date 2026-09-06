'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readPage, readPages } = require('../lib/api');
const { createTabSession } = require('../lib/tabSession');
const { toSkillError } = require('../lib/skillError');

const LONG_BODY = 'Readable article body with enough characters to pass the default eighty-character minimum.';

function allowlistedOptions(host = 'example.com') {
  return {
    autoAllowDomain: false,
    recordingMode: 'off',
    loadConfig: () => ({ security: { egressAllowlist: [host, '*.example'] } }),
    saveConfig() {
      throw new Error('config must not be written');
    },
    lookup: async () => [{ address: '93.184.216.34' }],
  };
}

function createBrowser() {
  return {
    serverUrl: 'ws://localhost:18080',
    openUrlCalls: 0,
    executeScriptCalls: 0,
    closedTabs: [],
    inFlight: 0,
    maxInFlight: 0,
    hostStarts: [],
    liveTabs: new Set(),
    tabUrls: new Map(),
    failUrls: new Set(),
    hangUntilAbort: false,
    async openUrl(url, tabId) {
      this.openUrlCalls += 1;
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      this.hostStarts.push({ host: new URL(url).hostname, at: Date.now() });
      const resolved = tabId || (200 + this.openUrlCalls);
      this.tabUrls.set(resolved, url);
      this.liveTabs.add(resolved);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return resolved;
    },
    async closeTab(tabId) {
      this.closedTabs.push(tabId);
      this.liveTabs.delete(tabId);
    },
    async executeScript(tabId, script, options = {}) {
      this.executeScriptCalls += 1;
      const url = this.tabUrls.get(tabId) || `tab:${tabId}`;
      if (this.hangUntilAbort) {
        await new Promise((_resolve, reject) => {
          const onAbort = () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (options.signal?.aborted) {
            onAbort();
            return;
          }
          options.signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (this.failUrls.has(url) && !String(script).includes('probePage')) {
        this.inFlight = Math.max(0, this.inFlight - 1);
        throw new Error('boom-one');
      }
      if (!String(script).includes('probePage')) {
        this.inFlight = Math.max(0, this.inFlight - 1);
      }
      return {
        title: 'ok',
        content: LONG_BODY,
        readyState: 'complete',
        contentChars: LONG_BODY.length,
        href: url,
        url,
      };
    },
  };
}

test('readPages never exceeds concurrency', async () => {
  const browser = createBrowser();
  const results = await readPages(browser, {
    urls: [
      'https://a.example/1',
      'https://b.example/2',
      'https://c.example/3',
      'https://d.example/4',
    ],
    format: 'text',
    concurrency: 2,
    perHostMinIntervalMs: 0,
    timeoutMs: 2000,
    totalTimeoutMs: 10000,
  }, allowlistedOptions());

  assert.equal(results.length, 4);
  assert.ok(results.every((item) => item.ok), JSON.stringify(results.map((item) => item.error)));
  assert.ok(browser.maxInFlight <= 2, `max in-flight ${browser.maxInFlight}`);
});

test('readPages keeps same-host starts at least perHostMinIntervalMs apart', async () => {
  const browser = createBrowser();
  const interval = 80;
  await readPages(browser, {
    urls: [
      'https://same.example/1',
      'https://same.example/2',
      'https://same.example/3',
    ],
    format: 'text',
    concurrency: 3,
    perHostConcurrency: 1,
    perHostMinIntervalMs: interval,
    timeoutMs: 2000,
    totalTimeoutMs: 10000,
  }, allowlistedOptions());

  const starts = browser.hostStarts.map((item) => item.at);
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= interval - 1, `${starts[1] - starts[0]}`);
  assert.ok(starts[2] - starts[1] >= interval - 1, `${starts[2] - starts[1]}`);
});

test('readPages isolates a single failure and returns the rest', async () => {
  const browser = createBrowser();
  browser.failUrls.add('https://b.example/bad');
  const results = await readPages(browser, {
    urls: [
      'https://a.example/ok',
      'https://b.example/bad',
      'https://c.example/ok',
    ],
    format: 'text',
    concurrency: 3,
    perHostMinIntervalMs: 0,
    timeoutMs: 2000,
    totalTimeoutMs: 10000,
  }, allowlistedOptions());

  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(typeof results[1].error.code, 'string');
  assert.match(results[1].error.message, /boom-one/);
  assert.equal(results[2].ok, true);
});

test('readPages caps live tabs and recycles self-opened tabs', async () => {
  const browser = createBrowser();
  const session = createTabSession({ maxOpenTabs: 2 });
  const results = await readPages(browser, {
    urls: [
      'https://a.example/1',
      'https://b.example/2',
      'https://c.example/3',
    ],
    format: 'text',
    concurrency: 2,
    perHostMinIntervalMs: 0,
    timeoutMs: 2000,
    totalTimeoutMs: 10000,
  }, {
    ...allowlistedOptions(),
    tabSession: session,
  });

  assert.ok(results.every((item) => item.ok));
  assert.equal(browser.liveTabs.size, 0);
  assert.equal(session.owned.size, 0);
  assert.ok(browser.closedTabs.length >= 3);
});

test('readPages cancel stops new work and recycles opened tabs', async () => {
  const browser = createBrowser();
  browser.hangUntilAbort = true;
  const controller = new AbortController();
  const pending = readPages(browser, {
    urls: [
      'https://a.example/1',
      'https://b.example/2',
      'https://c.example/3',
    ],
    format: 'text',
    concurrency: 1,
    perHostMinIntervalMs: 0,
    timeoutMs: 5000,
    totalTimeoutMs: 10000,
    signal: controller.signal,
  }, allowlistedOptions());

  await new Promise((resolve) => {
    const tick = () => (browser.openUrlCalls >= 1 ? resolve() : setImmediate(tick));
    tick();
  });
  controller.abort();
  const results = await pending;
  assert.equal(results.length, 3);
  assert.ok(results.every((item) => item.ok === false && item.error.code === 'cancelled'));
  assert.equal(browser.liveTabs.size, 0);
  assert.ok(browser.openUrlCalls <= 2);
});

test('readPages cache hits skip concurrency and tabs', async (t) => {
  const recording = {
    mode: 'standard',
    baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-batch-cache-')),
  };
  t.after(() => fs.rmSync(recording.baseDir, { recursive: true, force: true }));
  const browser = createBrowser();
  const url = 'https://example.com/cached';
  await readPage(browser, { url, format: 'text' }, {
    ...allowlistedOptions(),
    recording,
    recordingMode: 'standard',
    runId: 'seed',
  });
  const openedBefore = browser.openUrlCalls;
  const maxBefore = browser.maxInFlight;
  browser.maxInFlight = 0;
  browser.inFlight = 0;

  const results = await readPages(browser, {
    urls: [url, url],
    format: 'text',
    concurrency: 1,
    perHostMinIntervalMs: 0,
  }, {
    ...allowlistedOptions(),
    recording,
    recordingMode: 'standard',
    runId: 'batch-hit',
  });

  assert.ok(results.every((item) => item.ok && item.data._cached === true));
  assert.equal(browser.openUrlCalls, openedBefore);
  assert.equal(browser.maxInFlight, 0);
  assert.equal(maxBefore >= 0, true);
});

test('readPages throws invalid_params for an empty url list', async () => {
  await assert.rejects(
    () => readPages(createBrowser(), { urls: [] }, allowlistedOptions()),
    (error) => error.code === 'invalid_params',
  );
});

test('toSkillError remains the constructor used by batch item errors', () => {
  const error = toSkillError('timeout', 'batch item timed out');
  assert.equal(error.code, 'timeout');
  assert.equal(error.retryable, true);
});
