'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OfficialApiClient } = require('../lib/official-api/client');
const { parseApiArgs, runApi } = require('../lib/official-api/dispatcher');

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

function withApiEnv(run) {
  const keys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET', 'X_BEARER_TOKEN', 'X_API_BEARER_TOKEN', 'JS_X_SKIP_DOTENV'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.X_API_KEY = 'key';
  process.env.X_API_SECRET = 'secret';
  process.env.X_ACCESS_TOKEN = 'token';
  process.env.X_ACCESS_TOKEN_SECRET = 'token_secret';
  delete process.env.X_BEARER_TOKEN;
  delete process.env.X_API_BEARER_TOKEN;
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

test('OfficialApiClient.buildSignatureBase uses OAuth 1.0a parameter ordering', () => {
  const base = OfficialApiClient.buildSignatureBase('POST', 'https://api.x.com/2/tweets', {
    oauth_token: 'token',
    status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
    oauth_consumer_key: 'key',
    oauth_nonce: 'nonce',
  });
  assert.equal(
    base,
    'POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&oauth_consumer_key%3Dkey%26oauth_nonce%3Dnonce%26oauth_token%3Dtoken%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521',
  );
});

test('OfficialApiClient.createTweet posts to X API with OAuth header', async () => {
  await withFetchMock(async () => makeResponse({
    body: { data: { id: '12345', text: 'hello' } },
  }), async (calls) => {
    const client = new OfficialApiClient({
      apiKey: 'key',
      apiSecret: 'secret',
      accessToken: 'token',
      accessTokenSecret: 'token_secret',
    });
    const result = await client.createTweet('hello', ['media_1']);
    assert.equal(result.success, true);
    assert.equal(result.tweet_id, '12345');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.x.com/2/tweets');
    assert.equal(calls[0].opts.method, 'POST');
    assert.match(calls[0].opts.headers.Authorization, /^OAuth /);
    assert.deepEqual(JSON.parse(calls[0].opts.body), {
      text: 'hello',
      media: { media_ids: ['media_1'] },
    });
  });
});

test('OfficialApiClient uses Bearer token for read requests when available', async () => {
  await withNoApiEnv(() => withFetchMock(async () => makeResponse({
    body: { data: { id: '42' } },
  }), async (calls) => {
    const client = new OfficialApiClient({ bearerToken: 'Bearer read_token' });
    const result = await client.checkReadAccess();
    assert.equal(result.available, true);
    assert.equal(result.auth_type, 'bearer');
    assert.equal(calls[0].url, 'https://api.x.com/2/users/by/username/xdevelopers?user.fields=id');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer read_token');
    assert.equal(client.isReadConfigured, true);
    assert.equal(client.isWriteConfigured, false);
  }));
});

test('OfficialApiClient.getTrends reads Trends by WOEID with bearer auth', async () => {
  await withNoApiEnv(() => withFetchMock(async () => makeResponse({
    body: { data: [{ trend_name: '#AI', tweet_count: 250000 }] },
  }), async (calls) => {
    const client = new OfficialApiClient({ bearerToken: 'read_token' });
    const result = await client.getTrends(1);
    assert.equal(result.ok, true);
    assert.equal(result.woeid, '1');
    assert.deepEqual(result.trends, [{ trend_name: '#AI', tweet_count: 250000 }]);
    assert.equal(calls[0].url, 'https://api.x.com/2/trends/by/woeid/1');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer read_token');
  }));
});

test('OfficialApiClient prefers OAuth1 for user-context read status when configured', async () => {
  await withNoApiEnv(() => withFetchMock(async () => makeResponse({
    body: { data: { id: '99' } },
  }), async (calls) => {
    const client = new OfficialApiClient({
      apiKey: 'key',
      apiSecret: 'secret',
      accessToken: 'token',
      accessTokenSecret: 'token_secret',
      bearerToken: 'read_token',
    });
    const result = await client.checkReadAccess();
    assert.equal(result.available, true);
    assert.equal(result.auth_type, 'oauth1');
    assert.equal(calls[0].url, 'https://api.x.com/2/users/me?user.fields=id');
    assert.match(calls[0].opts.headers.Authorization, /^OAuth /);
  }));
});

test('OfficialApiClient.createTweet normalizes HTTP API errors', async () => {
  await withFetchMock(async () => makeResponse({
    ok: false,
    status: 403,
    body: { detail: 'Forbidden' },
  }), async () => {
    const client = new OfficialApiClient({
      apiKey: 'key',
      apiSecret: 'secret',
      accessToken: 'token',
      accessTokenSecret: 'token_secret',
    });
    const result = await client.createTweet('blocked');
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'forbidden');
    assert.equal(result.status_code, 403);
    assert.match(result.error, /Forbidden/);
  });
});

test('Official API media upload runs INIT / APPEND / FINALIZE', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'official_api_media_'));
  const mediaPath = path.join(tmpDir, 'image.png');
  fs.writeFileSync(mediaPath, Buffer.from('abc'), 'utf8');
  try {
    await withFetchMock(async (url, opts, calls) => {
      if (calls.length === 1) {
        assert.equal(String(url), 'https://api.x.com/2/media/upload/initialize');
        assert.equal(opts.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(String(opts.body)), {
          total_bytes: 3,
          media_type: 'image/png',
          media_category: 'tweet_image',
        });
        return makeResponse({ body: { data: { id: 'media123' } } });
      }
      if (calls.length === 2) {
        assert.equal(String(url), 'https://api.x.com/2/media/upload/media123/append');
        assert.match(opts.headers['Content-Type'], /^multipart\/form-data/);
        return makeResponse({ body: '' });
      }
      if (calls.length === 3) {
        assert.equal(String(url), 'https://api.x.com/2/media/upload/media123/finalize');
        assert.equal(opts.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(String(opts.body)), {});
        return makeResponse({ body: { data: { id: 'media123' } } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }, async (calls) => {
      const client = new OfficialApiClient({
        apiKey: 'key',
        apiSecret: 'secret',
        accessToken: 'token',
        accessTokenSecret: 'token_secret',
      });
      const result = await client.uploadMedia(mediaPath);
      assert.equal(result.success, true);
      assert.equal(result.media_id, 'media123');
      assert.equal(calls.length, 3);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parseApiArgs supports repeated --media-id flags', () => {
  const { opts, positional } = parseApiArgs(['tweet', 'hello', '--media-id', '1', '--media-id=2']);
  assert.deepEqual(positional, ['tweet', 'hello']);
  assert.deepEqual(opts.mediaIds, ['1', '2']);
});

test('parseApiArgs supports repeated --woeid flags', () => {
  const { opts, positional } = parseApiArgs(['trends', '--woeid', '1', '--woeid=23424977']);
  assert.deepEqual(positional, ['trends']);
  assert.deepEqual(opts.woeids, ['1', '23424977']);
});

test('parseApiArgs supports private tweet metrics flags', () => {
  const { opts, positional } = parseApiArgs(['tweets', '123', '--include-private-metrics', '--tweet-fields', 'id,text,public_metrics']);
  assert.deepEqual(positional, ['tweets', '123']);
  assert.equal(opts.includePrivateMetrics, true);
  assert.equal(opts.tweetFields, 'id,text,public_metrics');
});

test('runApi status returns structured api_not_configured without network', async () => {
  const { code, output } = await withNoApiEnv(() => silenceStdout(() => runApi(['status', '--pretty'])));
  assert.equal(code, 1);
  const envelope = JSON.parse(output);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'api_not_configured');
  assert.equal(envelope.result.configured, false);
});

test('runApi tweet writes success envelope through dispatcher', async () => {
  await withApiEnv(async () => withFetchMock(async () => makeResponse({
    body: { data: { id: '67890' } },
  }), async () => {
    const { code, output } = await silenceStdout(() => runApi(['tweet', 'hello']));
    assert.equal(code, 0);
    const envelope = JSON.parse(output);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.ok, true);
    assert.equal(envelope.result.success, true);
    assert.equal(envelope.result.tweet_id, '67890');
    assert.equal(envelope.result.via, 'official_api');
    assert.equal(envelope.meta.command, 'api tweet');
  }));
});

test('runApi trends merges repeated WOEID results', async () => {
  await withApiEnv(async () => withFetchMock(async (url) => {
    if (String(url).endsWith('/1')) {
      return makeResponse({ body: { data: [{ trend_name: '#AI', tweet_count: 250000 }] } });
    }
    return makeResponse({ body: { data: [{ trend_name: '#AI', tweet_count: 180000 }, { trend_name: 'Layoffs', tweet_count: 90000 }] } });
  }, async () => {
    const { code, output } = await silenceStdout(() => runApi(['trends', '--woeid', '1', '--woeid', '23424977']));
    assert.equal(code, 0);
    const envelope = JSON.parse(output);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.count, 2);
    assert.deepEqual(envelope.result.woeids, ['1', '23424977']);
    assert.equal(envelope.result.trends[0].trend_name, '#AI');
    assert.equal(envelope.result.trends[0].tweet_count, 250000);
    assert.deepEqual(envelope.result.trends[0].woeids, ['1', '23424977']);
    assert.equal(envelope.meta.command, 'api trends');
  }));
});

test('runApi mentions reads authenticated user mentions', async () => {
  await withApiEnv(async () => withFetchMock(async (url, opts, calls) => {
    if (calls.length === 1) {
      return makeResponse({ body: { data: { id: '99' } } });
    }
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/2/users/99/mentions');
    assert.equal(parsed.searchParams.get('max_results'), '25');
    return makeResponse({
      body: {
        data: [{ id: 'm1', text: '@imjszhang hello', author_id: 'u1', public_metrics: { like_count: 1 } }],
        includes: { users: [{ id: 'u1', username: 'alice', name: 'Alice' }] },
      },
    });
  }, async () => {
    const { code, output } = await silenceStdout(() => runApi(['mentions', '--max-results', '25']));
    assert.equal(code, 0);
    const envelope = JSON.parse(output);
    assert.equal(envelope.result.count, 1);
    assert.equal(envelope.result.tweets[0].author_username, 'alice');
    assert.equal(envelope.meta.command, 'api mentions');
  }));
});

test('runApi tweets can request private metrics with OAuth user context', async () => {
  await withApiEnv(async () => {
    process.env.X_BEARER_TOKEN = 'read_token';
    await withFetchMock(async (url, opts) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/2/tweets');
    assert.equal(parsed.searchParams.get('ids'), '123');
    assert.match(opts.headers.Authorization, /^OAuth /);
    const fields = parsed.searchParams.get('tweet.fields');
    assert.match(fields, /public_metrics/);
    assert.match(fields, /organic_metrics/);
    assert.match(fields, /non_public_metrics/);
    return makeResponse({
      body: {
        data: [{
          id: '123',
          text: 'hello',
          public_metrics: { impression_count: 10 },
          organic_metrics: { user_profile_clicks: 2 },
        }],
      },
    });
  }, async () => {
    const { code, output } = await silenceStdout(() => runApi(['tweets', '123', '--include-private-metrics']));
    assert.equal(code, 0);
    const envelope = JSON.parse(output);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.data[0].organic_metrics.user_profile_clicks, 2);
    assert.equal(envelope.meta.command, 'api tweets');
  });
  });
});
