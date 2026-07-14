'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { OfficialApiClient } = require('../lib/official-api/client');
const { parseApiArgs, runApi } = require('../lib/official-api/dispatcher');
const { buildSearchQueryOptions } = require('../lib/official-api/buildSearchQuery');
const { normalizeSearchTweet, normalizeSearchResults } = require('../lib/official-api/normalizeSearchTweet');

function makeResponse({ ok = true, status = 200, body = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
  };
}

async function withFetchMock(handler, run) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler(url, opts, calls);
  };
  try {
    return await run(calls);
  } finally {
    global.fetch = originalFetch;
  }
}

async function silenceStdout(run) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    const code = await run();
    return { code, output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function withBearerEnv(run) {
  const keys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET', 'X_BEARER_TOKEN', 'X_API_BEARER_TOKEN', 'JS_X_SKIP_DOTENV'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.X_BEARER_TOKEN = 'read_token';
  process.env.JS_X_SKIP_DOTENV = '1';
  try {
    return run();
  } finally {
    for (const k of keys) {
      if (old[k] == null) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

function withNoApiEnv(run) {
  const keys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET', 'X_BEARER_TOKEN', 'X_API_BEARER_TOKEN', 'JS_X_SKIP_DOTENV'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.JS_X_SKIP_DOTENV = '1';
  try {
    return run();
  } finally {
    for (const k of keys) {
      if (old[k] == null) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

const sampleSearchBody = {
  data: [{
    id: '100',
    text: 'hello archive',
    author_id: 'u1',
    created_at: '2020-01-01T00:00:00.000Z',
    lang: 'en',
    public_metrics: {
      reply_count: 1,
      retweet_count: 2,
      like_count: 3,
      quote_count: 0,
      bookmark_count: 0,
      impression_count: 99,
    },
    conversation_id: '100',
    attachments: { media_keys: ['m1'] },
  }],
  includes: {
    users: [{ id: 'u1', username: 'alice', name: 'Alice', profile_image_url: 'https://pbs.twimg.com/profile.jpg', verified: true }],
    media: [{
      media_key: 'm1',
      type: 'photo',
      url: 'https://pbs.twimg.com/media/abc.jpg',
    }],
  },
  meta: {
    result_count: 1,
    newest_id: '100',
    oldest_id: '100',
    next_token: 'page2',
  },
};

test('OfficialApiClient.searchAll hits search/all with Bearer auth', async () => {
  await withBearerEnv(() => withFetchMock(async (url, opts) => {
    assert.match(String(url), /\/2\/tweets\/search\/all\?/);
    assert.match(String(url), /query=AI/);
    assert.equal(opts.headers.Authorization, 'Bearer read_token');
    return makeResponse({ body: sampleSearchBody });
  }, async (calls) => {
    const client = new OfficialApiClient();
    const result = await client.searchAll('AI agent');
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.endpoint, 'search/all');
    assert.equal(result.tweets[0].author_username, 'alice');
    assert.equal(result.tweets[0].media.length, 1);
    assert.equal(calls.length, 1);
  }));
});

test('OfficialApiClient.searchAll paginates with next_token', async () => {
  await withBearerEnv(() => withFetchMock(async (url, opts, calls) => {
    const parsed = new URL(String(url));
    if (calls.length === 1) {
      assert.equal(parsed.searchParams.get('max_results'), '100');
      return makeResponse({ body: sampleSearchBody });
    }
    assert.equal(parsed.searchParams.get('next_token'), 'page2');
    return makeResponse({
      body: {
        data: [{ id: '101', text: 'page2', author_id: 'u1', public_metrics: {} }],
        includes: { users: [{ id: 'u1', username: 'alice', name: 'Alice' }] },
        meta: { result_count: 1 },
      },
    });
  }, async () => {
    const client = new OfficialApiClient();
    const result = await client.searchAll('AI', { maxPages: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.equal(result.tweets[1].id, '101');
  }));
});

test('OfficialApiClient.searchAll returns forbidden on first-page HTTP 403', async () => {
  await withBearerEnv(() => withFetchMock(async () => makeResponse({
    ok: false,
    status: 403,
    body: { detail: 'Forbidden' },
  }), async () => {
    const client = new OfficialApiClient();
    const result = await client.searchAll('blocked');
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'forbidden');
    assert.equal(result.count, 0);
    assert.deepEqual(result.tweets, []);
  }));
});

test('OfficialApiClient.searchRecent hits search/recent endpoint', async () => {
  await withBearerEnv(() => withFetchMock(async (url) => {
    assert.match(String(url), /\/2\/tweets\/search\/recent\?/);
    return makeResponse({ body: { ...sampleSearchBody, meta: { result_count: 1 } } });
  }, async () => {
    const client = new OfficialApiClient();
    const result = await client.searchRecent('MCP');
    assert.equal(result.ok, true);
    assert.equal(result.endpoint, 'search/recent');
    assert.equal(result.count, 1);
  }));
});

test('OfficialApiClient.searchAll returns api_not_configured without credentials', async () => {
  await withNoApiEnv(() => {
    const client = new OfficialApiClient();
    return client.searchAll('test').then((result) => {
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, 'api_not_configured');
    });
  });
});

test('buildSearchQueryOptions composes full query and maps since/until to API times', () => {
  const built = buildSearchQueryOptions({
    keyword: 'AI',
    from: 'foo',
    since: '2020-01-01',
    until: '2020-06-30',
    lang: 'en',
    minLikes: 10,
  });
  assert.match(built.fullQuery, /AI/);
  assert.match(built.fullQuery, /from:foo/);
  assert.match(built.fullQuery, /since:2020-01-01/);
  assert.match(built.fullQuery, /until:2020-06-30/);
  assert.match(built.fullQuery, /lang:en/);
  assert.match(built.fullQuery, /min_faves:10/);
  assert.equal(built.startTime, null);
  assert.equal(built.endTime, null);
});

test('buildSearchQueryOptions passes explicit startTime and endTime through', () => {
  const built = buildSearchQueryOptions({
    keyword: 'AI',
    startTime: '2020-01-01T00:00:00Z',
    endTime: '2020-06-30T23:59:59Z',
  });
  assert.equal(built.startTime, '2020-01-01T00:00:00Z');
  assert.equal(built.endTime, '2020-06-30T23:59:59Z');
  assert.equal(built.fullQuery, 'AI');
});

test('normalizeSearchTweet maps v2 tweet to bridge-compatible shape', () => {
  const normalized = normalizeSearchTweet({
    id: '100',
    text: 'hello',
    created_at: '2020-01-01T00:00:00.000Z',
    lang: 'en',
    author_username: 'alice',
    author_name: 'Alice',
    author_avatar_url: 'https://pbs.twimg.com/profile.jpg',
    author_verified: true,
    public_metrics: {
      reply_count: 1,
      retweet_count: 2,
      like_count: 3,
      quote_count: 0,
      bookmark_count: 0,
      impression_count: 99,
    },
    media: [{
      type: 'photo',
      url: 'https://pbs.twimg.com/media/abc.jpg',
    }],
  });
  assert.equal(normalized.tweetId, '100');
  assert.equal(normalized.content, 'hello');
  assert.equal(normalized.author.username, '@alice');
  assert.equal(normalized.stats.likes, 3);
  assert.equal(normalized.stats.views, 99);
  assert.equal(normalized.mediaUrls.length, 1);
  assert.equal(normalized.tweetUrl, 'https://x.com/alice/status/100');
  assert.equal(normalized.source, 'official_api');
});

test('normalizeSearchResults normalizes tweet arrays', () => {
  const result = normalizeSearchResults({
    tweets: [{ id: '1', text: 'a', author_username: 'u', public_metrics: {} }],
  });
  assert.equal(result.total, 1);
  assert.equal(result.tweets[0].tweetId, '1');
});

test('parseApiArgs supports search flags', () => {
  const { opts, positional } = parseApiArgs([
    'search-all', 'AI agent',
    '--start-time', '2020-01-01T00:00:00Z',
    '--sort-order', 'recency',
    '--from', 'foo',
    '--min-likes', '5',
    '--exclude-replies',
  ]);
  assert.deepEqual(positional, ['search-all', 'AI agent']);
  assert.equal(opts.startTime, '2020-01-01T00:00:00Z');
  assert.equal(opts.sortOrder, 'recency');
  assert.equal(opts.from, 'foo');
  assert.equal(opts.minLikes, 5);
  assert.equal(opts.excludeReplies, true);
});

test('runApi search-all returns normalized tweets envelope', async () => {
  await withBearerEnv(() => withFetchMock(async () => makeResponse({ body: sampleSearchBody }), async () => {
    const { code, output } = await silenceStdout(() => runApi(['search-all', 'AI agent', '--max-pages', '1', '--pretty']));
    assert.equal(code, 0);
    const envelope = JSON.parse(output);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.ok, true);
    assert.equal(envelope.result.count, 1);
    assert.equal(envelope.result.tweets[0].tweetId, '100');
    assert.equal(envelope.result.tweets[0].author.username, '@alice');
    assert.equal(envelope.result.endpoint, 'search/all');
    assert.equal(envelope.meta.command, 'api search-all');
  }));
});

test('runApi search-recent uses recent endpoint', async () => {
  await withBearerEnv(() => withFetchMock(async (url) => {
    assert.match(String(url), /\/2\/tweets\/search\/recent\?/);
    return makeResponse({ body: { data: [], meta: { result_count: 0 } } });
  }, async () => {
    const { code, output } = await silenceStdout(() => runApi(['search-recent', 'MCP']));
    assert.equal(code, 0);
    const envelope = JSON.parse(output);
    assert.equal(envelope.result.endpoint, 'search/recent');
    assert.equal(envelope.meta.command, 'api search-recent');
  }));
});

test('runApi search-all returns api_not_configured without credentials', async () => {
  const { code, output } = await withNoApiEnv(() => silenceStdout(() => runApi(['search-all', 'test'])));
  assert.equal(code, 1);
  const envelope = JSON.parse(output);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.result.errorCode, 'api_not_configured');
});

test('runApi search-all surfaces forbidden with permission hint', async () => {
  await withBearerEnv(() => withFetchMock(async () => makeResponse({
    ok: false,
    status: 403,
    body: { detail: 'Forbidden' },
  }), async () => {
    const { code, output } = await silenceStdout(() => runApi(['search-all', 'blocked']));
    assert.equal(code, 1);
    const envelope = JSON.parse(output);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.result.errorCode, 'forbidden');
    assert.match(envelope.result.error, /Pay-per-use/);
  }));
});
