'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parsers = require('../lib/serp/parsers');
const { cheerioPage } = require('../lib/serp/pageAdapters');

const FIX = path.join(__dirname, 'fixtures');

function load(name, url) {
  return cheerioPage(fs.readFileSync(path.join(FIX, name), 'utf8'), url);
}

describe('unpackGoogleHref', () => {
  it('unwraps /url?q= and /imgres', () => {
    assert.equal(
      parsers.unpackGoogleHref('/url?q=https://nodejs.org/en&sa=U', 'https://www.google.com/search'),
      'https://nodejs.org/en',
    );
    const img = parsers.unpackGoogleHref(
      'https://www.google.com/imgres?imgurl=https://cdn.example.com/full.jpg&imgrefurl=https://cdn.example.com/page',
      'https://www.google.com/search',
    );
    assert.equal(img, 'https://cdn.example.com/full.jpg');
  });
});

describe('parse fixtures', () => {
  it('parses web results and skips google chrome links', () => {
    const page = load('web.html', 'https://www.google.com/search?q=nodejs&udm=14');
    const result = parsers.parseWebResults(page, { limit: 10 });
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].url, 'https://nodejs.org/en');
    assert.equal(result.items[0].title.includes('Node.js'), true);
    assert.equal(result.items.some((item) => /google\.com/.test(item.url)), false);
  });

  it('parses news with source and time', () => {
    const page = load('news.html', 'https://www.google.com/search?q=openai&tbm=nws');
    const result = parsers.parseNewsResults(page, { limit: 10 });
    assert.ok(result.items.length >= 2);
    assert.equal(result.items[0].url.includes('reuters.com'), true);
    assert.equal(result.items[0].publishedAt, '2026-09-01T08:00:00Z');
  });

  it('parses images without following data URIs', () => {
    const page = load('images.html', 'https://www.google.com/search?q=cat&tbm=isch');
    const result = parsers.parseImagesResults(page, { limit: 10 });
    assert.ok(result.items.length >= 2);
    assert.equal(result.items[0].sourceUrl, 'https://example.com/cats/photo');
    assert.match(result.items[0].thumbnailUrl, /encrypted-tbn0/);
    assert.equal(result.items.some((item) => String(item.thumbnailUrl).startsWith('data:')), false);
  });

  it('parses scholar cite and pdf', () => {
    const page = load('scholar.html', 'https://scholar.google.com/scholar?q=attention');
    const result = parsers.parseScholarResults(page, { limit: 10 });
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].url, 'https://arxiv.org/abs/1706.03762');
    assert.equal(result.items[0].pdfUrl, 'https://arxiv.org/pdf/1706.03762.pdf');
    assert.equal(result.items[0].year, 2017);
    assert.match(result.items[0].cite, /Vaswani/);
  });

  it('treats empty SERP as empty', () => {
    const page = load('empty.html', 'https://www.google.com/search?q=zzzznoresults&udm=14');
    const result = parsers.parseWebResults(page, { limit: 5 });
    assert.equal(result.empty, true);
    assert.equal(result.items.length, 0);
  });

  it('dedupes by normalized url', () => {
    const items = parsers.dedupeItems([
      { url: 'https://example.com/a/' },
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
    ]);
    assert.equal(items.length, 2);
  });
});


describe('card-scoped descriptions', () => {
  it('does not use long titles as snippets or leak a neighboring card', () => {
    const page = cheerioPage(`<div id="rso">
      <div class="g"><a href="https://example.com/long"><h3>This title is deliberately much longer than twenty characters</h3></a><div class="VwiC3b">Actual description of the first result.</div></div>
      <div class="g"><a href="https://example.com/empty"><h3>Another very long title with no description</h3></a></div>
      <div class="g"><a href="https://example.com/next"><h3>Third title</h3></a><p>Only the third result describes this content.</p></div>
    </div>`, 'https://www.google.com/search?q=fixture');
    assert.deepEqual(parsers.parseWebResults(page, {}).items.map((item) => item.snippet), [
      'Actual description of the first result.', '', 'Only the third result describes this content.',
    ]);
  });
  it('does not consume the result limit on duplicate links', () => {
    const page = cheerioPage(`<div id="search"><div><a href="https://example.com/a"><h3>A</h3></a><div>First description.</div></div><div><a href="https://example.com/a"><h3>Duplicate</h3></a></div><div><a href="https://example.com/b"><h3>B</h3></a><div>Second description.</div></div></div>`, 'https://www.google.com/search');
    assert.equal(parsers.parseWebResults(page, { limit: 2 }).items.length, 2);
  });
  it('keeps plain description and news metadata separate', () => {
    assert.equal(parsers.parseWebResults(load('web.html', 'https://www.google.com/search'), {}).items[0].snippet, 'Node.js is an open-source, cross-platform JavaScript runtime environment.');
    const items = parsers.parseNewsResults(load('news.html', 'https://www.google.com/search?tbm=nws'), {}).items;
    assert.equal(items[0].snippet, 'A cleaned fixture snippet about OpenAI.');
    assert.equal(items[1].snippet, '');
    assert.equal(items[1].source, 'BBC');
  });
});
