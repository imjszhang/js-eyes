'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const targets = require('../lib/toolTargets');

describe('searchUrl', () => {
  it('builds web search with udm=14', () => {
    const url = new URL(targets.searchUrl({ query: 'nodejs', vertical: 'web' }));
    assert.equal(url.hostname, 'www.google.com');
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('q'), 'nodejs');
    assert.equal(url.searchParams.get('udm'), '14');
  });

  it('encodes unicode query', () => {
    const url = new URL(targets.searchUrl({ query: '大模型 agent', vertical: 'web' }));
    assert.equal(url.searchParams.get('q'), '大模型 agent');
  });

  it('maps news/images/scholar params', () => {
    const news = new URL(targets.searchUrl({ query: 'ai', vertical: 'news', timeRange: 'd', language: 'en', region: 'us' }));
    assert.equal(news.searchParams.get('tbm'), 'nws');
    assert.equal(news.searchParams.get('tbs'), 'qdr:d');
    assert.equal(news.searchParams.get('hl'), 'en');
    assert.equal(news.searchParams.get('gl'), 'us');

    const images = new URL(targets.searchUrl({ query: 'cat', vertical: 'images', safeSearch: 'active' }));
    assert.equal(images.searchParams.get('tbm'), 'isch');
    assert.equal(images.searchParams.get('safe'), 'active');

    const scholar = new URL(targets.searchUrl({
      query: 'transformer',
      vertical: 'scholar',
      yearFrom: 2017,
      yearTo: 2020,
      sortBy: 'date',
    }));
    assert.equal(scholar.hostname, 'scholar.google.com');
    assert.equal(scholar.searchParams.get('as_ylo'), '2017');
    assert.equal(scholar.searchParams.get('as_yhi'), '2020');
    assert.equal(scholar.searchParams.get('scisbd'), '1');
  });

  it('paginates with start', () => {
    const url = new URL(targets.searchUrl({ query: 'x', vertical: 'web', pageIndex: 2 }));
    assert.equal(url.searchParams.get('start'), '20');
  });

  it('rejects missing query and unknown hosts', () => {
    assert.throws(() => targets.searchUrl({}), /query/);
    assert.throws(() => targets.assertAllowedUrl('https://mail.google.com/'), /host/);
  });
});
