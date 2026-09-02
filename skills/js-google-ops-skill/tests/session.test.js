'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { Session, pickTabMatchingProfile, expandBridgeSource, shouldCloseCreatedTab } = require('../lib/session');
const { PAGE_PROFILES } = require('../lib/config');

function mockBot({ tabs = [], scripts = {} } = {}) {
  const opened = [];
  const closed = [];
  return {
    opened,
    closed,
    async getTabs() { return tabs; },
    async openUrl(url, tabId) {
      opened.push({ url, tabId });
      return tabId == null ? 42 : tabId;
    },
    async closeTab(id) { closed.push(id); },
    async executeScript(tabId, code) {
      if (code.includes('readyState')) return { readyState: 'complete', url: opened.length ? opened[opened.length - 1].url : 'https://www.google.com/' };
      if (code.includes('__meta.version')) return scripts.version || null;
      if (typeof scripts.install === 'function') return scripts.install(code);
      return { ok: true, version: '1.0.0', name: 'search-bridge' };
    },
    disconnect() {},
  };
}

describe('profile scoring', () => {
  it('scores google search vs scholar', () => {
    const searchTab = { id: 1, url: 'https://www.google.com/search?q=a&tbm=nws' };
    const scholarTab = { id: 2, url: 'https://scholar.google.com/scholar?q=a' };
    const other = { id: 3, url: 'https://mail.google.com/' };
    assert.ok(PAGE_PROFILES.search.score(searchTab) > PAGE_PROFILES.search.score(other));
    assert.equal(PAGE_PROFILES.search.score(other), 0);
    assert.ok(PAGE_PROFILES.scholar.score(scholarTab) >= 500);
    assert.equal(PAGE_PROFILES.scholar.score(searchTab), 0);
  });

  it('picks the highest scoring tab', () => {
    const tabs = [
      { id: 1, url: 'https://www.google.com/' },
      { id: 2, url: 'https://www.google.com/search?q=hi&udm=14', is_active: true },
    ];
    const hit = pickTabMatchingProfile(tabs, PAGE_PROFILES.search);
    assert.equal(hit.id, 2);
  });
});

describe('tab lifecycle', () => {
  it('forceNewTab opens a new tab even when a matching tab exists', async () => {
    const bot = mockBot({
      tabs: [{ id: 9, url: 'https://www.google.com/search?q=old' }],
    });
    const session = new Session({
      opts: {
        page: 'search',
        bot,
        forceNewTab: true,
        closeCreatedTab: true,
        createUrl: 'https://www.google.com/search?q=hi&udm=14',
      },
    });
    await session.resolveTarget();
    assert.equal(session.target.rawId, 42);
    assert.equal(session.target._created, true);
    assert.equal(bot.opened.length, 1);
    await session.closeCreatedTab();
    assert.deepEqual(bot.closed, [42]);
  });

  it('never closes reused or explicit tabs', async () => {
    const bot = mockBot({
      tabs: [{ id: 7, url: 'https://www.google.com/search?q=keep' }],
    });
    const reused = new Session({
      opts: { page: 'search', bot, forceNewTab: false, reuseAnyGoogleTab: true, closeCreatedTab: true },
    });
    await reused.resolveTarget();
    assert.equal(reused.target._created, undefined);
    assert.equal(shouldCloseCreatedTab(reused.target, reused.opts), false);

    const explicit = new Session({
      opts: { page: 'search', bot, tab: 7, closeCreatedTab: true, targetUrl: null },
    });
    await explicit.resolveTarget();
    assert.equal(shouldCloseCreatedTab(explicit.target, explicit.opts), false);
  });

  it('reinstalls a stale bridge version', async () => {
    let installed = 0;
    const bot = mockBot({
      tabs: [{ id: 3, url: 'https://www.google.com/search?q=a' }],
      scripts: {
        version: '0.0.1',
        install(code) {
          if (code.includes('__jse_google_search__')) {
            installed += 1;
            return { ok: true, version: '1.0.0', name: 'search-bridge' };
          }
          return null;
        },
      },
    });
    const session = new Session({
      opts: { page: 'search', bot, forceNewTab: false, reuseAnyGoogleTab: true, closeCreatedTab: false },
    });
    await session.resolveTarget();
    const meta = await session.ensureBridge();
    assert.equal(meta.reinstalled, true);
    assert.equal(meta.version, '1.0.0');
    assert.ok(installed >= 1);
  });
});

describe('expandBridgeSource', () => {
  it('inlines common and parsers', () => {
    const raw = [
      'const VERSION = "1.0.0";',
      '// @@include ./common.js',
      '// @@include ../lib/serp/parsers.js',
    ].join('\n');
    const expanded = expandBridgeSource(raw, path.join(__dirname, '..', 'bridges'));
    assert.match(expanded, /function asPage/);
    assert.match(expanded, /function unpackGoogleHref/);
    assert.doesNotMatch(expanded, /^[ \t]*\/\/\s*@@include\s+/m);
  });
});
