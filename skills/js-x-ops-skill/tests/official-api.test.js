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
  const keys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.X_API_KEY = 'key';
  process.env.X_API_SECRET = 'secret';
  process.env.X_ACCESS_TOKEN = 'token';
  process.env.X_ACCESS_TOKEN_SECRET = 'token_secret';
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
  const base = OfficialApiClient.buildSignatureBase('POST', 'https://api.twitter.com/2/tweets', {
    oauth_token: 'token',
    status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
    oauth_consumer_key: 'key',
    oauth_nonce: 'nonce',
  });
  assert.equal(
    base,
    'POST&https%3A%2F%2Fapi.twitter.com%2F2%2Ftweets&oauth_consumer_key%3Dkey%26oauth_nonce%3Dnonce%26oauth_token%3Dtoken%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521',
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
    assert.equal(calls[0].url, 'https://api.twitter.com/2/tweets');
    assert.equal(calls[0].opts.method, 'POST');
    assert.match(calls[0].opts.headers.Authorization, /^OAuth /);
    assert.deepEqual(JSON.parse(calls[0].opts.body), {
      text: 'hello',
      media: { media_ids: ['media_1'] },
    });
  });
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
        assert.match(String(opts.body), /command=INIT/);
        return makeResponse({ body: { media_id_string: 'media123' } });
      }
      if (calls.length === 2) {
        assert.match(opts.headers['Content-Type'], /^multipart\/form-data/);
        return makeResponse({ body: '' });
      }
      if (calls.length === 3) {
        assert.match(String(opts.body), /command=FINALIZE/);
        return makeResponse({ body: { media_id_string: 'media123' } });
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

test('runApi status returns structured api_not_configured without network', async () => {
  const { code, output } = await silenceStdout(() => runApi(['status', '--pretty']));
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
