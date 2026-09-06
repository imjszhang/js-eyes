'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createCacheKey,
  getCacheFilePath,
  writeCacheEntry,
} = require('@js-eyes/skill-recording');
const browserUtils = require('../lib/browserUtils');
const { generateReadPageScript } = browserUtils;
const {
  readPage,
  clickElement,
  fillForm,
  waitFor,
  scrollPage,
  takeScreenshot,
} = require('../lib/api');
const {
  hostMatches,
  normalizeHost,
  PolicyDeniedError,
  authorizeUrlForRead,
  isPrivateLiteral,
} = require('../lib/egressAllowlist');
const { createRunContext, normalizeUrl } = require('../lib/runContext');
const pkg = require('../package.json');
const definition = require('../skill.definition');

function createRecording(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-browser-cache-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  return { mode: 'standard', baseDir };
}

function createBrowser() {
  return {
    serverUrl: 'ws://localhost:18080',
    openUrlCalls: 0,
    executeScriptCalls: 0,
    tabUrls: new Map(),
    async openUrl(url) {
      this.openUrlCalls += 1;
      const tabId = 100 + this.openUrlCalls;
      this.tabUrls.set(tabId, url);
      return tabId;
    },
    async executeScript(tabId, script) {
      this.executeScriptCalls += 1;
      const formatMatch = script.match(/var fmt = ("(?:[^"\\]|\\.)*");/);
      const format = formatMatch ? JSON.parse(formatMatch[1]) : 'unknown';
      const url = this.tabUrls.get(tabId) || `tab:${tabId}`;
      return {
        title: `${format} title`,
        author: '',
        content: `${format} content ${url}`,
        excerpt: '',
        siteName: '',
        url,
        images: [],
        links: [],
      };
    },
  };
}

function allowlistedOptions(host = 'example.com') {
  return {
    autoAllowDomain: false,
    loadConfig: () => ({ security: { egressAllowlist: [host] } }),
    saveConfig() {
      throw new Error('config must not be written');
    },
    lookup: async () => [{ address: '93.184.216.34' }],
  };
}

function cacheFileFor(recording, params) {
  const context = createRunContext({
    skillId: pkg.name,
    skillVersion: pkg.version,
    scrapeType: 'read',
    ...params,
    recording,
  });
  return getCacheFilePath(context, 'read');
}

test('egress host normalization and wildcard matching are boundary-safe', () => {
  assert.equal(normalizeHost('https://Docs.Example.com/a'), 'docs.example.com');
  assert.equal(normalizeHost('docs.example.com'), 'docs.example.com');
  assert.equal(normalizeHost('https://localhost:18080/a'), 'localhost');
  assert.equal(hostMatches('docs.example.com', '*.example.com'), true);
  assert.equal(hostMatches('example.com', '*.example.com'), false);
  assert.equal(hostMatches('badexample.com', '*.example.com'), false);
});

test('browserUtils exports only the read-page extraction generator', () => {
  assert.deepEqual(Object.keys(browserUtils), ['generateReadPageScript']);
  const read = generateReadPageScript('markdown');
  assert.doesNotThrow(() => new Function(read));
});

test('API keeps read-page extraction and routes browser actions through first-class SDK methods', async () => {
  const calls = [];
  const options = { recordingMode: 'off' };
  const browser = {
    async executeScript(tabId, script) {
      calls.push(['executeScript', tabId, script]);
      return { title: 'Example', content: 'page body' };
    },
    async click(...args) {
      calls.push(['click', ...args]);
      return { success: true };
    },
    async fill(...args) {
      calls.push(['fill', ...args]);
      return { success: true };
    },
    async waitFor(...args) {
      calls.push(['waitFor', ...args]);
      return { success: true };
    },
    async scroll(...args) {
      calls.push(['scroll', ...args]);
      return { success: true };
    },
    async captureScreenshot(...args) {
      calls.push(['captureScreenshot', ...args]);
      return { dataUrl: 'data:image/jpeg;base64,AA==' };
    },
  };

  const readResult = await readPage(browser, { tabId: 42, format: 'text' }, options);
  await clickElement(browser, { tabId: 42, selector: '#submit', text: 'Go', index: 1 }, options);
  await fillForm(browser, { tabId: 42, selector: '#query', value: 'hello', clearFirst: true, index: 2 }, options);
  await waitFor(browser, { tabId: 42, selector: '.results', timeout: 10, visible: true }, options);
  await scrollPage(browser, { tabId: 42, target: 'bottom', selector: '.footer', pixels: 300 }, options);
  await takeScreenshot(browser, { tabId: 42, fullPage: true, format: 'jpeg', quality: 80 }, options);

  assert.equal(readResult.tabId, 42);
  assert.match(calls[0][2], /function extractContent\(\)/);
  assert.match(calls[0][2], /var fmt = "text";/);
  assert.deepEqual(calls.slice(1), [
    ['click', 42, { selector: '#submit', text: 'Go', index: 1 }, options],
    ['fill', 42, { selector: '#query', value: 'hello', clearFirst: true, index: 2 }, options],
    ['waitFor', 42, { selector: '.results', timeout: 10, visible: true }, options],
    ['scroll', 42, { scrollTarget: 'bottom', selector: '.footer', pixels: 300 }, options],
    ['captureScreenshot', 42, { fullPage: true, format: 'jpeg', quality: 80 }],
  ]);
});

test('definition keeps interaction risks and capabilities explicit', () => {
  const tools = new Map(definition.TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
  assert.equal(tools.get('browser_read_page').risk, 'read');
  assert.equal(tools.get('browser_click').risk, 'interactive');
  assert.ok(tools.get('browser_click').capabilities.includes('browser.page.interact'));
  assert.ok(tools.get('browser_screenshot').capabilities.includes('browser.screenshot'));
});

test('readPage cache hits preserve the miss response shape and cache metadata', async (t) => {
  const recording = createRecording(t);
  const browser = createBrowser();
  const params = { url: 'https://example.com/page', format: 'markdown' };

  const miss = await readPage(browser, params, {
    recording,
    ...allowlistedOptions(),
    runId: 'cache-miss',
  });
  const hit = await readPage(browser, params, {
    recording,
    ...allowlistedOptions(),
    runId: 'cache-hit',
  });

  assert.deepEqual(Object.keys(hit).sort(), Object.keys(miss).sort());
  assert.deepEqual(hit, {
    ...miss,
    tabId: null,
    _cached: true,
    run: { id: 'cache-hit' },
  });
  assert.equal(miss._cached, false);
  assert.equal(hit._cached, true);
  assert.equal(hit.content, miss.content);
  assert.equal(typeof miss.tabId, 'number');
  assert.equal(hit.tabId, null);
  assert.deepEqual(miss.run, { id: 'cache-miss' });
  assert.deepEqual(hit.run, { id: 'cache-hit' });
  assert.equal(browser.openUrlCalls, 1);
  assert.equal(browser.executeScriptCalls, 1);

  const entry = JSON.parse(fs.readFileSync(cacheFileFor(recording, params), 'utf8'));
  assert.equal(entry.format, 'markdown');
  assert.equal(typeof entry.fetchedAt, 'string');
  assert.equal(Number.isNaN(Date.parse(entry.fetchedAt)), false);
  assert.equal(Object.prototype.hasOwnProperty.call(entry.response, 'tabId'), false);
});

test('readPage cache keys isolate output formats', async (t) => {
  const recording = createRecording(t);
  const browser = createBrowser();
  const url = 'https://example.com/formats';

  const markdown = await readPage(browser, { url, format: 'markdown' }, {
    recording,
    ...allowlistedOptions(),
  });
  const html = await readPage(browser, { url, format: 'html' }, {
    recording,
    ...allowlistedOptions(),
  });
  const markdownHit = await readPage(browser, { url, format: 'markdown' }, {
    recording,
    ...allowlistedOptions(),
  });

  assert.equal(markdown._cached, false);
  assert.equal(html._cached, false);
  assert.equal(markdownHit._cached, true);
  assert.equal(markdownHit.content, markdown.content);
  assert.notEqual(html.content, markdown.content);
  assert.equal(browser.executeScriptCalls, 2);
});

test('readPage cache keys preserve URL fragments, ref queries, and trailing slashes', (t) => {
  const recording = createRecording(t);
  const keyFor = (url) => createRunContext({
    skillId: pkg.name,
    skillVersion: pkg.version,
    scrapeType: 'read',
    url,
    recording,
    format: 'markdown',
  }).cacheKey;

  const pairs = [
    ['https://example.com/app#/alpha', 'https://example.com/app#/beta'],
    ['https://example.com/app?ref=alpha', 'https://example.com/app?ref=beta'],
    ['https://example.com/path', 'https://example.com/path/'],
  ];
  for (const [left, right] of pairs) {
    assert.equal(normalizeUrl(left), left);
    assert.equal(normalizeUrl(right), right);
    assert.notEqual(keyFor(left), keyFor(right));
  }
});

test('readPage does not cross-hit URLs with distinct output-bearing components', async (t) => {
  const recording = createRecording(t);
  const browser = createBrowser();
  const pairs = [
    ['https://example.com/app#/alpha', 'https://example.com/app#/beta'],
    ['https://example.com/app?ref=alpha', 'https://example.com/app?ref=beta'],
    ['https://example.com/path', 'https://example.com/path/'],
  ];

  for (const [left, right] of pairs) {
    const leftResult = await readPage(browser, { url: left, format: 'markdown' }, {
      recording,
      ...allowlistedOptions(),
    });
    const rightResult = await readPage(browser, { url: right, format: 'markdown' }, {
      recording,
      ...allowlistedOptions(),
    });
    assert.equal(leftResult._cached, false);
    assert.equal(rightResult._cached, false);
    assert.notEqual(leftResult.content, rightResult.content);
  }
  assert.equal(browser.executeScriptCalls, 6);
});

test('readPage cache key ignores parameters that do not affect current output', (t) => {
  const recording = createRecording(t);
  const createContext = (params) => createRunContext({
    skillId: pkg.name,
    skillVersion: pkg.version,
    scrapeType: 'read',
    url: 'https://example.com/current-output',
    recording,
    format: 'markdown',
    ...params,
  });
  const baseKey = createContext({}).cacheKey;

  assert.equal(createContext({ tabId: 42 }).cacheKey, baseKey);
  assert.equal(createContext({ maxContentChars: 1000 }).cacheKey, baseKey);
  assert.equal(createContext({ includeLinks: false }).cacheKey, baseKey);
});

test('readPage bypasses URL cache when a runtime tabId is supplied', async (t) => {
  const recording = createRecording(t);
  const browser = createBrowser();
  const params = {
    url: 'https://example.com/runtime-tab',
    tabId: 42,
    format: 'markdown',
  };

  const first = await readPage(browser, params, {
    recording,
    ...allowlistedOptions(),
  });
  const second = await readPage(browser, params, {
    recording,
    ...allowlistedOptions(),
  });

  assert.equal(first._cached, false);
  assert.equal(second._cached, false);
  assert.equal(browser.executeScriptCalls, 2);
});

test('readPage cache schema v2 cannot hit schema v1 entries', async (t) => {
  const recording = createRecording(t);
  const browser = createBrowser();
  const params = { url: 'https://example.com/legacy', format: 'markdown' };
  const currentContext = createRunContext({
    skillId: pkg.name,
    skillVersion: pkg.version,
    scrapeType: 'read',
    ...params,
    recording,
  });
  const legacyCacheKey = createCacheKey({
    skillId: pkg.name,
    scrapeType: 'read',
    url: params.url,
    version: pkg.version,
    readPage: {
      schema: 1,
      format: 'markdown',
      tabId: null,
      maxContentChars: null,
      includeLinks: true,
    },
  });
  assert.notEqual(currentContext.cacheKey, legacyCacheKey);
  writeCacheEntry({
    ...currentContext,
    cacheKey: legacyCacheKey,
  }, {
    response: { content: 'stale schema v1 content', tabId: 999 },
    fetchedAt: new Date().toISOString(),
    format: 'markdown',
  }, 'read');

  const result = await readPage(browser, params, {
    recording,
    ...allowlistedOptions(),
  });

  assert.equal(result._cached, false);
  assert.notEqual(result.content, 'stale schema v1 content');
  assert.equal(browser.executeScriptCalls, 1);
});

test('unauthorized hosts fail closed without writing config', async () => {
  let saved = false;
  await assert.rejects(
    () => authorizeUrlForRead('https://evil.example/path', {
      loadConfig: () => ({ security: { egressAllowlist: [] } }),
      saveConfig() { saved = true; },
      lookup: async () => [{ address: '93.184.216.34' }],
    }),
    (error) => error instanceof PolicyDeniedError
      && error.code === 'policy_denied'
      && error.retryable === false
      && error.details.reason === 'not_allowlisted',
  );
  assert.equal(saved, false);
});

test('session opt-in grants a host without persisting config', async () => {
  const granted = [];
  let saved = false;
  const result = await authorizeUrlForRead('https://docs.example.com/a', {
    autoAllowDomain: true,
    loadConfig: () => ({ security: { egressAllowlist: [] } }),
    saveConfig() { saved = true; },
    lookup: async () => [{ address: '93.184.216.34' }],
    policy: { egress: { allowSession(url) { granted.push(url); } } },
  });
  assert.equal(result.mode, 'session');
  assert.equal(saved, false);
  assert.deepEqual(granted, ['https://docs.example.com/a']);
});

test('explicit persist writes config and audits the host', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-egress-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previous = process.env.JS_EYES_HOME;
  process.env.JS_EYES_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.JS_EYES_HOME;
    else process.env.JS_EYES_HOME = previous;
  });

  const writes = [];
  await assert.rejects(
    () => authorizeUrlForRead('https://docs.example.com/a', {
      persistAllowDomain: true,
      runId: 'run-1',
      actor: 'test',
      loadConfig: () => ({ security: { egressAllowlist: [] } }),
      saveConfig(next) { writes.push(next.security.egressAllowlist); },
      lookup: async () => [{ address: '93.184.216.34' }],
      timeoutMs: 10,
      intervalMs: 5,
    }),
    (error) => error.code === 'policy_denied' && error.details.reason === 'allowlist_not_hot_reloaded',
  );
  assert.deepEqual(writes, [['docs.example.com']]);
  const audit = fs.readFileSync(path.join(home, 'logs', 'egress-allowlist-audit.jsonl'), 'utf8');
  assert.match(audit, /docs\.example\.com/);
  assert.match(audit, /run-1/);
});

test('private and confused addresses are denied without a second confirmation', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://localhost/',
    'http://192.168.1.8/',
    'http://10.0.0.1/',
    'http://169.254.1.1/',
    'http://2130706433/',
  ]) {
    await assert.rejects(
      () => authorizeUrlForRead(url, {
        autoAllowDomain: true,
        loadConfig: () => ({ security: { egressAllowlist: ['127.0.0.1', 'localhost'] } }),
        saveConfig() { throw new Error('must not write'); },
      }),
      (error) => error.details.reason === 'private_network',
    );
  }
  assert.equal(isPrivateLiteral('127.0.0.1'), true);
  assert.equal(isPrivateLiteral('::1'), true);
});
