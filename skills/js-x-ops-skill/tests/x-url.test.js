'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractTweetId,
  extractArticleId,
  classifyXPostInput,
  canonicalNavigateUrl,
  buildPostBridgeArgs,
  isResolvablePostInput,
} = require('../lib/xUrl');

describe('lib/xUrl', () => {
  it('extractTweetId: status URL 与纯数字', () => {
    assert.equal(extractTweetId('2076652814286102649'), '2076652814286102649');
    assert.equal(
      extractTweetId('https://x.com/SorsaApp/status/1234567890?s=20'),
      '1234567890',
    );
  });

  it('extractTweetId: t.co 与 article URL 返回 null', () => {
    assert.equal(extractTweetId('https://t.co/irHOIYXWF2'), null);
    assert.equal(extractTweetId('https://x.com/i/article/2062147039652155392'), null);
    assert.equal(
      extractTweetId('https://x.com/0xMoysei/article/2076385221633774022'),
      '2076385221633774022',
    );
  });

  it('extractArticleId: /i/article/', () => {
    assert.equal(
      extractArticleId('https://x.com/i/article/2062147039652155392'),
      '2062147039652155392',
    );
  });

  it('classifyXPostInput: article / tweet / short', () => {
    assert.deepEqual(classifyXPostInput('https://t.co/irHOIYXWF2'), {
      kind: 'short',
      url: 'https://t.co/irHOIYXWF2',
      raw: 'https://t.co/irHOIYXWF2',
    });
    assert.deepEqual(classifyXPostInput('https://x.com/i/article/2062147039652155392'), {
      kind: 'article',
      articleId: '2062147039652155392',
      url: 'https://x.com/i/article/2062147039652155392',
      raw: 'https://x.com/i/article/2062147039652155392',
    });
    assert.equal(classifyXPostInput('https://x.com/foo/status/99').kind, 'tweet');
    assert.deepEqual(classifyXPostInput('https://x.com/0xMoysei/article/2076385221633774022'), {
      kind: 'tweet',
      tweetId: '2076385221633774022',
      url: 'https://x.com/0xMoysei/article/2076385221633774022',
      raw: 'https://x.com/0xMoysei/article/2076385221633774022',
    });
    assert.equal(classifyXPostInput('not-a-url').kind, 'unknown');
  });

  it('canonicalNavigateUrl', () => {
    const article = classifyXPostInput('https://x.com/i/article/1');
    assert.equal(canonicalNavigateUrl(article), 'https://x.com/i/article/1');
    const short = classifyXPostInput('https://t.co/abc');
    assert.equal(canonicalNavigateUrl(short), 'https://t.co/abc');
  });

  it('buildPostBridgeArgs', () => {
    const articleArgs = buildPostBridgeArgs(
      classifyXPostInput('https://x.com/i/article/42'),
      { withThread: true },
    );
    assert.equal(articleArgs.contentKind, 'article');
    assert.equal(articleArgs.articleId, '42');
    assert.equal(articleArgs.withThread, true);
    assert.equal(articleArgs.tweetId, undefined);
  });

  it('isResolvablePostInput', () => {
    assert.equal(isResolvablePostInput('https://t.co/x'), true);
    assert.equal(isResolvablePostInput('https://x.com/i/article/1'), true);
    assert.equal(isResolvablePostInput('garbage'), false);
  });
});
