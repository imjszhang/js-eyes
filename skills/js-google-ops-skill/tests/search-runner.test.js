'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runSearch, blockerFromExtract } = require('../lib/searchRunner');

function mockSession(pages) {
  let index = 0;
  const opened = [];
  const session = {
    opened,
    target: { id: '1', rawId: 1, url: '', _created: true },
    async openTargetUrl(url) {
      opened.push(url);
      session.target.url = url;
    },
    async ensureBridge() { return { version: '1.0.0' }; },
    async callApi() {
      const page = pages[Math.min(index, pages.length - 1)];
      index += 1;
      return page;
    },
  };
  return session;
}

function pageOk(items, extra) {
  return {
    ok: true,
    data: Object.assign({ items, empty: items.length === 0, blocker: null }, extra || {}),
  };
}

describe('runSearch', () => {
  it('aggregates pages, dedupes, and stops at limit', async () => {
    const session = mockSession([
      pageOk([{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/' }]),
      pageOk([{ title: 'A', url: 'https://a.example' }, { title: 'C', url: 'https://c.example/' }]),
    ]);
    const result = await runSearch(session, { query: 'q', vertical: 'web', limit: 2, maxPages: 2 }, { throttleMs: 0 });
    assert.equal(result.items.length, 2);
    assert.equal(result.pageInfo.endedReason, 'limit');
    assert.equal(result.pageInfo.pagesFetched >= 1, true);
    assert.equal(result.items[0].rank, 1);
  });

  it('returns partial results when a later page is blocked', async () => {
    const session = mockSession([
      pageOk([{ title: 'A', url: 'https://a.example/' }]),
      { ok: false, error: 'captcha_required', reason: 'sorry_path', blocker: { kind: 'captcha_required', reason: 'sorry_path' } },
    ]);
    const result = await runSearch(session, { query: 'q', vertical: 'web', limit: 10, maxPages: 2 }, { throttleMs: 0 });
    assert.equal(result.items.length, 1);
    assert.equal(result.blocker.kind, 'captcha_required');
    assert.equal(result.pageInfo.endedReason, 'blocker');
  });

  it('fails cleanly on first-page captcha with no items', async () => {
    const session = mockSession([
      { ok: false, error: 'consent_required', blocker: { kind: 'consent_required', reason: 'consent_host' } },
    ]);
    const result = await runSearch(session, { query: 'q', vertical: 'web' }, { throttleMs: 0 });
    assert.equal(result.items.length, 0);
    assert.equal(result.blocker.kind, 'consent_required');
  });

  it('stops on empty page', async () => {
    const session = mockSession([pageOk([])]);
    const result = await runSearch(session, { query: 'q', vertical: 'news' }, { throttleMs: 0 });
    assert.equal(result.blocker.kind, 'no_results');
    assert.equal(result.pageInfo.endedReason, 'no_results');
  });
});

describe('blockerFromExtract', () => {
  it('maps extract errors', () => {
    assert.equal(blockerFromExtract({ error: 'dom_timeout' }).kind, 'dom_timeout');
    assert.equal(blockerFromExtract({ ok: true, data: { blocker: { kind: 'no_results' } } }).kind, 'no_results');
  });
});
