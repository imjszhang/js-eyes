'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getCacheFilePath } = require('@js-eyes/skill-recording');
const {
  generateClickScript,
  generateFillFormScript,
  generateReadPageScript,
} = require('../lib/browserUtils');
const { readPage } = require('../lib/api');
const { hostMatches, normalizeHost } = require('../lib/egressAllowlist');
const { createRunContext } = require('../lib/runContext');
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
    async openUrl() {
      this.openUrlCalls += 1;
      return 100 + this.openUrlCalls;
    },
    async executeScript(tabId, script) {
      this.executeScriptCalls += 1;
      const formatMatch = script.match(/var fmt = ("(?:[^"\\]|\\.)*");/);
      const format = formatMatch ? JSON.parse(formatMatch[1]) : 'unknown';
      return {
        title: `${format} title`,
        author: '',
        content: `${format} content ${this.executeScriptCalls}`,
        excerpt: '',
        siteName: '',
        url: `https://example.com/page#tab-${tabId}`,
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
    _cached: true,
    run: { id: 'cache-hit' },
  });
  assert.equal(miss._cached, false);
  assert.equal(hit._cached, true);
  assert.equal(hit.content, miss.content);
  assert.equal(hit.tabId, miss.tabId);
  assert.deepEqual(miss.run, { id: 'cache-miss' });
  assert.deepEqual(hit.run, { id: 'cache-hit' });
  assert.equal(browser.openUrlCalls, 1);
  assert.equal(browser.executeScriptCalls, 1);

  const entry = JSON.parse(fs.readFileSync(cacheFileFor(recording, params), 'utf8'));
  assert.equal(entry.format, 'markdown');
  assert.equal(typeof entry.fetchedAt, 'string');
  assert.equal(Number.isNaN(Date.parse(entry.fetchedAt)), false);
  assert.equal(entry.response.tabId, miss.tabId);
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

test('readPage cache keys reserve stable output-option dimensions', (t) => {
  const recording = createRecording(t);
  const url = 'https://example.com/vary';
  const keyFor = (params) => createRunContext({
    skillId: pkg.name,
    skillVersion: pkg.version,
    scrapeType: 'read',
    url,
    recording,
    ...params,
  }).cacheKey;
  const baseKey = keyFor({ format: 'markdown' });

  assert.equal(keyFor({}), baseKey);
  assert.notEqual(keyFor({ format: 'html' }), baseKey);
  assert.notEqual(keyFor({ tabId: 42 }), baseKey);
  assert.notEqual(keyFor({ maxContentChars: 1000 }), baseKey);
  assert.notEqual(keyFor({ includeLinks: false }), baseKey);
});

test('readPage explicitly refreshes legacy cache entries without format metadata', async (t) => {
  const recording = createRecording(t);
  const browser = createBrowser();
  const params = { url: 'https://example.com/legacy', format: 'markdown' };

  const seed = await readPage(browser, params, {
    recording,
    autoAllowDomain: false,
  });
  const cacheFile = cacheFileFor(recording, params);
  const legacyEntry = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  delete legacyEntry.format;
  delete legacyEntry.fetchedAt;
  delete legacyEntry.response.tabId;
  fs.writeFileSync(cacheFile, JSON.stringify(legacyEntry), 'utf8');

  const refreshed = await readPage(browser, params, {
    recording,
    autoAllowDomain: false,
  });
  const hit = await readPage(browser, params, {
    recording,
    autoAllowDomain: false,
  });

  assert.equal(seed._cached, false);
  assert.equal(refreshed._cached, false);
  assert.equal(typeof refreshed.content, 'string');
  assert.notEqual(refreshed.content, seed.content);
  assert.equal(hit._cached, true);
  assert.equal(hit.content, refreshed.content);
  assert.equal(browser.executeScriptCalls, 2);
});
