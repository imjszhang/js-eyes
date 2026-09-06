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
const {
  generateClickScript,
  generateFillFormScript,
  generateReadPageScript,
} = require('../lib/browserUtils');
const { readPage, cleanupTabSession } = require('../lib/api');
const { createTabSession, TabOwnershipError } = require('../lib/tabSession');
const { hostMatches, normalizeHost } = require('../lib/egressAllowlist');
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
    closedTabs: [],
    navigations: [],
    tabUrls: new Map(),
    async openUrl(url, tabId) {
      this.openUrlCalls += 1;
      this.navigations.push({ url, tabId: tabId || null });
      const resolved = tabId || (100 + this.openUrlCalls);
      this.tabUrls.set(resolved, url);
      return resolved;
    },
    async closeTab(tabId) {
      this.closedTabs.push(tabId);
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

test('generated scripts safely serialize caller-controlled values', () => {
  const read = generateReadPageScript({ format: 'markdown' });
  const click = generateClickScript({ selector: "button[data-x=\"'\\\\\"]" });
  const fill = generateFillFormScript({ selector: '#q', value: '</script>\\nhello' });
  assert.doesNotThrow(() => new Function(read));
  assert.doesNotThrow(() => new Function(click));
  assert.doesNotThrow(() => new Function(fill));
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
    autoAllowDomain: false,
    runId: 'cache-miss',
  });
  const hit = await readPage(browser, params, {
    recording,
    autoAllowDomain: false,
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
  assert.equal(miss.tabId, null);
  assert.equal(hit.tabId, null);
  assert.deepEqual(browser.closedTabs, [101]);
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
    autoAllowDomain: false,
  });
  const html = await readPage(browser, { url, format: 'html' }, {
    recording,
    autoAllowDomain: false,
  });
  const markdownHit = await readPage(browser, { url, format: 'markdown' }, {
    recording,
    autoAllowDomain: false,
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
      autoAllowDomain: false,
    });
    const rightResult = await readPage(browser, { url: right, format: 'markdown' }, {
      recording,
      autoAllowDomain: false,
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
    autoAllowDomain: false,
    allowExternalTab: true,
  });
  const second = await readPage(browser, params, {
    recording,
    autoAllowDomain: false,
    allowExternalTab: true,
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
    autoAllowDomain: false,
  });

  assert.equal(result._cached, false);
  assert.notEqual(result.content, 'stale schema v1 content');
  assert.equal(browser.executeScriptCalls, 1);
});

test('url plus tabId navigates that tab instead of reading the old page', async () => {
  const browser = createBrowser();
  const session = createTabSession();
  session.claim(7);
  const result = await readPage(browser, {
    url: 'https://example.com/next',
    tabId: 7,
    format: 'markdown',
  }, {
    recordingMode: 'off',
    autoAllowDomain: false,
    tabSession: session,
    keepOpen: true,
  });
  assert.deepEqual(browser.navigations, [{ url: 'https://example.com/next', tabId: 7 }]);
  assert.equal(result.url, 'https://example.com/next');
  assert.equal(result.tabId, 7);
});

test('url plus tabId throws when navigation cannot target that tab', async () => {
  const browser = createBrowser();
  const session = createTabSession();
  session.claim(7);
  browser.openUrl = async () => 99;
  await assert.rejects(
    () => readPage(browser, {
      url: 'https://example.com/next',
      tabId: 7,
      format: 'markdown',
    }, {
      recordingMode: 'off',
      autoAllowDomain: false,
      tabSession: session,
      keepOpen: true,
    }),
    /无法在标签 7 内导航/,
  );
});

test('self-opened tabs close by default and stay open only with keepOpen', async () => {
  const browser = createBrowser();
  const session = createTabSession();
  const closed = await readPage(browser, { url: 'https://example.com/a', format: 'text' }, {
    recordingMode: 'off',
    autoAllowDomain: false,
    tabSession: session,
  });
  assert.equal(closed.tabId, null);
  assert.deepEqual(browser.closedTabs, [101]);

  const kept = await readPage(browser, { url: 'https://example.com/b', format: 'text' }, {
    recordingMode: 'off',
    autoAllowDomain: false,
    tabSession: session,
    keepOpen: true,
  });
  assert.equal(kept.tabId, 102);
  assert.equal(session.owns(102), true);
});

test('external tabs are rejected unless explicitly opted in', async () => {
  const browser = createBrowser();
  await assert.rejects(
    () => readPage(browser, { url: 'https://example.com/x', tabId: 9, format: 'text' }, {
      recordingMode: 'off',
      autoAllowDomain: false,
    }),
    (error) => error instanceof TabOwnershipError && error.code === 'tab_not_owned',
  );
  assert.equal(browser.openUrlCalls, 0);
});

test('errors and session cleanup still recycle owned tabs', async () => {
  const browser = createBrowser();
  const session = createTabSession();
  browser.executeScript = async () => {
    throw new Error('boom');
  };
  await assert.rejects(
    () => readPage(browser, { url: 'https://example.com/err', format: 'text' }, {
      recordingMode: 'off',
      autoAllowDomain: false,
      tabSession: session,
    }),
    /boom/,
  );
  assert.deepEqual(browser.closedTabs, [101]);

  browser.executeScript = async (tabId) => ({
    title: 'ok',
    content: 'ok',
    url: browser.tabUrls.get(tabId),
  });
  const kept = await readPage(browser, { url: 'https://example.com/keep', format: 'text' }, {
    recordingMode: 'off',
    autoAllowDomain: false,
    tabSession: session,
    keepOpen: true,
  });
  await cleanupTabSession(browser, { tabSession: session });
  assert.ok(browser.closedTabs.includes(kept.tabId));
  await cleanupTabSession(browser, { tabSession: session });
});

test('keepOpen and closeAfter cannot both be true', async () => {
  const browser = createBrowser();
  await assert.rejects(
    () => readPage(browser, { url: 'https://example.com/conflict', format: 'text' }, {
      recordingMode: 'off',
      autoAllowDomain: false,
      keepOpen: true,
      closeAfter: true,
    }),
    /keepOpen and closeAfter cannot both be true/,
  );
  assert.equal(browser.openUrlCalls, 0);
});

test('tab pool queues extra opens and abort removes the waiter', async () => {
  const browser = createBrowser();
  const session = createTabSession({ maxOpenTabs: 1 });
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  browser.executeScript = async () => {
    await hold;
    return { title: 'held', content: 'held', url: 'https://example.com/hold' };
  };
  const first = readPage(browser, { url: 'https://example.com/hold', format: 'text' }, {
    recordingMode: 'off',
    autoAllowDomain: false,
    tabSession: session,
  });
  await new Promise((resolve) => {
    const tick = () => (browser.openUrlCalls >= 1 ? resolve() : setImmediate(tick));
    tick();
  });
  const controller = new AbortController();
  const queued = readPage(browser, { url: 'https://example.com/queued', format: 'text' }, {
    recordingMode: 'off',
    autoAllowDomain: false,
    tabSession: session,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(() => queued, (error) => error.name === 'AbortError');
  release();
  await first;
  assert.equal(browser.openUrlCalls, 1);
});
