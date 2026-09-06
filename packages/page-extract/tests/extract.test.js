'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  extractPageContent,
  generateReadPageScript,
  normalizeExtractOptions,
} = require('..');

const FIXTURES = path.join(__dirname, '..', '__fixtures__');

function loadDocument(name, url = 'https://example.com/page') {
  const html = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  return new JSDOM(html, { url, pretendToBeVisual: true }).window.document;
}

describe('extractPageContent fixtures', () => {
  it('keeps table rows and columns in markdown', () => {
    const result = extractPageContent(loadDocument('table.html'), { format: 'markdown' });
    assert.match(result.content, /\| Model \| RAM \| Price \|/);
    assert.match(result.content, /\| --- \| --- \| --- \|/);
    assert.match(result.content, /\| Alpha \| 8 GB \| \$199 \|/);
    assert.match(result.content, /\| Beta \| 16 GB \| \$299 \|/);
    assert.equal(result.status, 'ok');
  });

  it('preserves ordered numbers and nested list indentation', () => {
    const result = extractPageContent(loadDocument('lists.html'), { format: 'markdown' });
    assert.match(result.content, /1\. Install runtime/);
    assert.match(result.content, / {2}1\. Download the package/);
    assert.match(result.content, / {2}2\. Verify the checksum/);
    assert.match(result.content, /2\. Configure/);
    assert.match(result.content, / {2}- Set the server URL/);
    assert.match(result.content, / {2}- Enable the extension/);
    assert.match(result.content, /3\. Run a smoke test/);
    assert.doesNotMatch(result.content, /^- Install runtime/m);
  });

  it('does not treat nested DIVs as paragraphs', () => {
    const result = extractPageContent(loadDocument('div-layout.html'), { format: 'markdown' });
    assert.match(result.content, /Hello world/);
    assert.doesNotMatch(result.content, /Hello\n\n\s*world/);
    assert.equal((result.content.match(/\n{3,}/g) || []).length, 0);
  });

  it('reads publishedTime, canonicalUrl, lang, and JSON-LD Article fields', () => {
    const result = extractPageContent(loadDocument('metadata-article.html', 'https://example.com/news/live'), {
      format: 'markdown',
    });
    assert.equal(result.publishedTime, '2024-01-15T10:00:00Z');
    assert.equal(result.modifiedTime, '2024-02-01T12:00:00Z');
    assert.equal(result.canonicalUrl, 'https://example.com/news/canonical');
    assert.equal(result.lang, 'zh-CN');
    assert.equal(result.author, 'Ada Lovelace');
    assert.equal(result.jsonLd['@type'], 'NewsArticle');
    assert.equal(result.status, 'ok');
  });

  it('marks Cloudflare challenge pages as blocked without a successful body', () => {
    const result = extractPageContent(loadDocument('cloudflare-challenge.html'), { format: 'markdown' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.blockedReason, 'cloudflare_challenge');
    assert.equal(result.content, '');
  });

  it('marks 403 access-denied pages as blocked', () => {
    const result = extractPageContent(loadDocument('access-denied.html'), { format: 'text' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.blockedReason, 'access_denied');
    assert.equal(result.content, '');
  });

  it('recovers content from a legacy page without main/article landmarks', () => {
    const result = extractPageContent(loadDocument('no-main-legacy.html'), { format: 'markdown' });
    assert.equal(result.status, 'ok');
    assert.match(result.content, /Legacy feature/);
    assert.match(result.content, /old layout has no main/);
  });

  it('truncates oversized content and sets truncated:true', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `<p>Block ${i} ${'word '.repeat(20)}</p>`).join('');
    const document = new JSDOM(
      `<!DOCTYPE html><html><body><article>${paragraphs}</article></body></html>`,
      { url: 'https://example.com/long' },
    ).window.document;
    const result = extractPageContent(document, { format: 'text', maxContentChars: 120 });
    assert.equal(result.truncated, true);
    assert.ok(result.content.length <= 120);
    assert.equal(result.contentChars, result.content.length);
  });

  it('filters hidden, aria-hidden, and display:none subtrees', () => {
    const result = extractPageContent(loadDocument('hidden-seo.html'), { format: 'markdown' });
    assert.match(result.content, /Public headline/);
    assert.match(result.content, /visible and should appear/);
    assert.doesNotMatch(result.content, /keyword stuffing/);
    assert.doesNotMatch(result.content, /Aria hidden SEO bait/);
    assert.doesNotMatch(result.content, /display none stuffed/);
  });

  it('sanitizes html format: no script, style, or on* attributes', () => {
    const result = extractPageContent(loadDocument('dirty-html.html'), { format: 'html' });
    assert.equal(result.status, 'ok');
    assert.doesNotMatch(result.content, /<script/i);
    assert.doesNotMatch(result.content, /<style/i);
    assert.doesNotMatch(result.content, /\son\w+\s*=/i);
    assert.doesNotMatch(result.content, /javascript:/i);
    assert.match(result.content, /Safe text/);
    assert.match(result.content, /https:\/\/example.com\/ok/);
  });
});

describe('generateReadPageScript', () => {
  it('inlines the same extractPageContent function body', () => {
    const script = generateReadPageScript('markdown', { maxContentChars: 5000 });
    assert.match(script, /function extractPageContent/);
    assert.match(script, /"format":"markdown"/);
    assert.match(script, /"maxContentChars":5000/);
    assert.doesNotThrow(() => new Function(script));
    assert.ok(script.includes(extractPageContent.toString()));
  });
});

describe('normalizeExtractOptions', () => {
  it('defaults format to markdown and keeps output-changing flags', () => {
    assert.deepEqual(normalizeExtractOptions({}), {
      format: 'markdown',
      includeLinks: true,
      includeImages: true,
      maxContentChars: 0,
      maxLinks: 100,
      maxImages: 50,
    });
    assert.equal(normalizeExtractOptions({ format: 'html', includeLinks: false }).includeLinks, false);
    assert.equal(normalizeExtractOptions({ maxContentChars: 12 }).maxContentChars, 12);
  });
});
