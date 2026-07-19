'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const skillRoot = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');

test('x-post and api remain thin compatibility facades', () => {
  assert.ok(read('scripts/x-post.js').split('\n').length <= 100);
  assert.ok(read('lib/api.js').split('\n').length <= 150);
  assert.deepEqual(Object.keys(require('../scripts/x-post')), [
    'main', 'parseArgs', 'extractTweetId', 'classifyXPostInput',
    'buildDiscoverTweetQueryIdsScript', 'buildTweetDetailScript',
    'buildTweetDetailCursorScript', 'buildParseTweetResultSnippet',
    'buildTweetByRestIdScript', 'buildPostDomScript', 'buildReplyViaDomScript',
    'postReplyViaDom', 'buildReplyViaIntentScript', 'postReplyViaIntent',
    'buildDiscoverCreateTweetQueryIdScript', 'buildCreateReplyScript',
    'postReplyViaMutation', 'buildCreateNewTweetScript', 'postNewTweetViaMutation',
    'buildNewTweetViaDomScript', 'postNewTweetViaDom', 'buildQuoteTweetViaDomScript',
    'postQuoteTweetViaDom',
  ]);
  assert.deepEqual(Object.keys(require('../lib/api')), [
    'searchTweets', 'getProfileTweets', 'getPost', 'getHomeFeed', 'postRunToolDispatch',
  ]);
});

test('new hotspot modules stay bounded and independent from entry facades', () => {
  const modules = [
    'commands/post-options.js', 'dom/post-read.js', 'dom/post-write.js',
    'flows/post.js', 'flows/post-write.js', 'graphql/tweet-detail.js',
    'graphql/tweet-parser.js', 'graphql/tweet-write.js', 'media/composer-image.js',
    ...fs.readdirSync(path.join(skillRoot, 'lib/api')).map((name) => `lib/api/${name}`),
  ];
  for (const modulePath of modules) {
    const source = read(modulePath);
    assert.ok(source.split('\n').length <= 800, modulePath);
    if (modulePath !== 'lib/api/script-loaders.js') {
      assert.doesNotMatch(source, /require\(['"]\.\.\/\.\.\/scripts\/x-post['"]\)/, modulePath);
    }
  }
});

test('post options parse explicit argv without mutating process state', () => {
  const { parseArgs } = require('../commands/post-options');
  const options = parseArgs([
    '123', '--with-thread', '--with-replies', '7', '--post', 'hello',
    '--quote', '456', '--via', 'dom', '--dry-run',
  ]);
  assert.deepEqual(options.tweetInputs, ['123']);
  assert.equal(options.withThread, true);
  assert.equal(options.withReplies, 7);
  assert.equal(options.post, 'hello');
  assert.equal(options.quote, '456');
  assert.equal(options.via, 'dom');
  assert.equal(options.dryRun, true);
});

test('dry-run exits before any official API write', async () => {
  const { tryOfficialApiWrite } = require('../flows/post-write');
  const result = await tryOfficialApiWrite({ dryRun: true }, {
    isReplyMode: false, replyTweetId: '', hasPost: true, hasThread: false,
    hasQuote: false, quoteTweetId: '',
  });
  assert.deepEqual(result, { attempted: false, success: false, result: null });
});

test('search routing preserves bridge-first and fallback order', async () => {
  const bridge = require('../lib/api/bridge-routing').createMethods({
    classifyBridgeError: () => 'bridge_error',
  });
  const calls = [];
  const fallback = require('../lib/api/fallback').createMethods({
    ...bridge,
    FALLBACK_REASON: { DISABLED_BY_ENV: 'disabled' },
    classifyBridgeError: () => 'bridge_error',
    makeLog: () => ({ warn() {} }),
    searchViaRunTool: async () => { calls.push('bridge'); throw new Error('bridge down'); },
    runSearchTweets: async () => { calls.push('legacy'); return { metrics: {} }; },
  });
  const result = await fallback._searchWithBridgeOrFallback({}, 'agents', {});
  assert.deepEqual(calls, ['bridge', 'legacy']);
  assert.equal(result._bridgeRoute.bridgeFallback, true);

  calls.length = 0;
  await fallback._searchWithBridgeOrFallback({}, 'agents', { useBridge: false });
  assert.deepEqual(calls, ['legacy']);
});

test('generated GraphQL and DOM scripts remain syntactically valid', () => {
  const post = require('../scripts/x-post');
  const scripts = [
    post.buildDiscoverTweetQueryIdsScript(),
    post.buildTweetDetailScript('123', 'query-id', {}, false, false),
    post.buildPostDomScript('123'),
    post.buildCreateReplyScript('123', 'hello', 'query-id', {}),
    post.buildNewTweetViaDomScript('hello'),
  ];
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});
