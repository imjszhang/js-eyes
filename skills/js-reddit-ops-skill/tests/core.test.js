'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PAGE_PROFILES, getPageProfile } = require('../lib/config');
const {
  inboxListUrl,
  listSubredditUrl,
  postUrl,
  searchUrl,
  userProfileUrl,
} = require('../lib/toolTargets');
const definition = require('../skill.definition');

test('Reddit target builders preserve route semantics and encode input', () => {
  assert.equal(listSubredditUrl({ sub: 'MachineLearning', sort: 'new' }),
    'https://www.reddit.com/r/MachineLearning/new/');
  assert.equal(searchUrl({ q: 'local agents', sub: 'LocalLLaMA', sort: 'new', restrictSr: true }),
    'https://www.reddit.com/r/LocalLLaMA/search/?q=local+agents&sort=new&restrict_sr=1');
  assert.equal(userProfileUrl({ name: 'alice', tab: 'saved' }),
    'https://www.reddit.com/user/alice/saved/');
  assert.equal(inboxListUrl({ box: 'mentions' }),
    'https://www.reddit.com/message/mentions/');
  assert.equal(postUrl({ permalink: '/r/test/comments/abc/title/' }),
    'https://www.reddit.com/r/test/comments/abc/title/');
});

test('page profiles and V2 definition expose the supported surface', () => {
  assert.deepEqual(
    Object.keys(PAGE_PROFILES).sort(),
    ['home', 'inbox', 'post', 'search', 'subreddit', 'user'],
  );
  assert.equal(getPageProfile('post').score({
    url: 'https://www.reddit.com/r/test/comments/abc/title/',
    is_active: true,
  }), 1500);
  assert.throws(() => getPageProfile('compose'), { code: 'E_BAD_ARG' });
  assert.equal(definition.TOOL_DEFINITIONS.length, 15);
  assert.equal(definition.TOOL_DEFINITIONS.some((tool) => tool.risk === 'destructive'), false);
});
