'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { isPromotedTweet } = require('../lib/promotedDetection');
const { buildTweetParserSnippet } = require('../lib/xUtils');

function makeNode(text = '', ariaLabel = '') {
  return {
    textContent: text,
    getAttribute(name) {
      return name === 'aria-label' ? ariaLabel : null;
    },
  };
}

function makeArticle({ explicitPromoted = false, tweetText = 'organic post' } = {}) {
  const placement = makeNode();
  const textNode = makeNode(tweetText);
  textNode.contains = (candidate) => candidate === textNode;
  const userSpans = [makeNode('Example User'), makeNode('@example')];
  const userName = {
    querySelectorAll: () => userSpans,
    contains: (candidate) => userSpans.includes(candidate),
  };
  const promotedLabel = explicitPromoted ? makeNode('Promoted', 'Promoted') : null;
  const statusLink = {
    getAttribute(name) {
      return name === 'href' ? '/example/status/1234567890' : null;
    },
  };

  return {
    innerText: `${tweetText}\n1 reply\n2 likes`,
    querySelector(selector) {
      if (selector.includes('[aria-label="Promoted"]')) return promotedLabel;
      if (selector === '[data-testid="placementTracking"]') return placement;
      if (selector === '[data-testid="socialContext"]') return null;
      if (selector === '[data-testid="tweetText"]') return textNode;
      if (selector === '[data-testid="User-Name"]') return userName;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'span, [dir="auto"]') return [textNode, ...userSpans];
      if (selector === 'a[href*="/status/"]') return [statusLink];
      return [];
    },
  };
}

describe('promoted tweet detection', () => {
  it('keeps an organic tweet that has placementTracking', () => {
    assert.equal(isPromotedTweet(makeArticle()), false);
  });

  it('filters a tweet with an explicit promoted label', () => {
    assert.equal(isPromotedTweet(makeArticle({ explicitPromoted: true })), true);
  });

  it('does not treat the word Promoted inside tweet text as an ad label', () => {
    assert.equal(isPromotedTweet(makeArticle({ tweetText: 'Promoted is a word in this post' })), false);
  });

  it('uses the same detector in the legacy parser snippet', () => {
    const context = { article: makeArticle() };
    vm.createContext(context);
    vm.runInContext(
      `${buildTweetParserSnippet()}\nglobalThis.parsed = parseTweetArticle(article);`,
      context,
    );
    assert.equal(context.parsed.tweetId, '1234567890');
    assert.equal(context.parsed.content, 'organic post');
  });
});
