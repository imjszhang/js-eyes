'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveProxyUrl,
  getProxyInfo,
  getProxyDispatcher,
  sanitizeProxyHost,
  classifyProxyProtocol,
  normalizeSocks5ProxyUrl,
  fetchWithTimeout,
} = require('../lib/official-api/httpFetch');

const { withProxyEnv, withFetchMock } = require('./helpers/official-api-env');

test('fetch mocks override inherited proxies until async work settles, then restore them', async () => {
  await withProxyEnv({ HTTPS_PROXY: 'http://127.0.0.1:1' }, async () => {
    const originalFetch = global.fetch;
    await assert.rejects(withFetchMock(async () => ({ ok: true }), async (calls) => {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(getProxyInfo().enabled, false);
      assert.equal((await fetchWithTimeout('https://api.x.com/2/users/me')).ok, true);
      assert.equal(calls.length, 1);
      throw new Error('mock failure');
    }), /mock failure/);
    assert.equal(global.fetch, originalFetch);
    assert.equal(resolveProxyUrl().url, 'http://127.0.0.1:1');
  });
});

test('proxy environment remains isolated across await and restores after rejection', async () => {
  await withProxyEnv({ ALL_PROXY: 'http://127.0.0.1:1' }, async () => {
    await assert.rejects(withProxyEnv({}, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(resolveProxyUrl(), null);
      throw new Error('async failure');
    }), /async failure/);
    assert.equal(resolveProxyUrl().url, 'http://127.0.0.1:1');
  });
});

test('resolveProxyUrl prefers JS_X_OPS_PROXY over HTTPS_PROXY', async () => {
  await withProxyEnv({
    JS_X_OPS_PROXY: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:9999',
  }, () => {
    const resolved = resolveProxyUrl();
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:7890',
      source: 'JS_X_OPS_PROXY',
    });
  });
});

test('resolveProxyUrl falls back to HTTPS_PROXY', async () => {
  await withProxyEnv({
    HTTPS_PROXY: 'http://127.0.0.1:7890',
  }, () => {
    const resolved = resolveProxyUrl();
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:7890',
      source: 'HTTPS_PROXY',
    });
  });
});

test('JS_X_OPS_PROXY=off forces direct and ignores lower-priority proxies', async () => {
  await withProxyEnv({
    JS_X_OPS_PROXY: 'off',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
  }, () => {
    assert.equal(resolveProxyUrl(), null);
    assert.deepEqual(getProxyInfo(), {
      enabled: false,
      source: null,
      host: null,
      protocol: null,
    });
  });
});

test('sanitizeProxyHost strips credentials from proxy URL', () => {
  assert.equal(sanitizeProxyHost('http://user:secret@127.0.0.1:7890'), '127.0.0.1:7890');
  assert.equal(sanitizeProxyHost('socks5://user:secret@127.0.0.1:1080'), '127.0.0.1:1080');
  assert.equal(sanitizeProxyHost('http://127.0.0.1:7890'), '127.0.0.1:7890');
});

test('classifyProxyProtocol accepts http and socks5; rejects socks4', () => {
  assert.equal(classifyProxyProtocol('http://127.0.0.1:7890'), 'http');
  assert.equal(classifyProxyProtocol('https://proxy.example:8443'), 'http');
  assert.equal(classifyProxyProtocol('socks5://127.0.0.1:1080'), 'socks5');
  assert.equal(classifyProxyProtocol('socks://127.0.0.1:1080'), 'socks5');
  assert.equal(classifyProxyProtocol('socks5h://127.0.0.1:1080'), 'socks5');
  assert.throws(() => classifyProxyProtocol('socks4://127.0.0.1:1080'), /SOCKS4/);
  assert.throws(() => classifyProxyProtocol('ftp://127.0.0.1:21'), /Unsupported proxy URL/);
});

test('normalizeSocks5ProxyUrl maps socks/socks5h to socks5', () => {
  assert.equal(normalizeSocks5ProxyUrl('socks://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
  assert.equal(normalizeSocks5ProxyUrl('socks5h://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
  assert.equal(normalizeSocks5ProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
});

test('getProxyDispatcher creates Socks5ProxyAgent for SOCKS proxies', async () => {
  await withProxyEnv({
    JS_X_OPS_PROXY: 'socks5://127.0.0.1:1080',
  }, () => {
    const dispatcher = getProxyDispatcher();
    assert.ok(dispatcher);
    assert.equal(dispatcher.constructor.name, 'Socks5ProxyAgent');
    assert.deepEqual(getProxyInfo(), {
      enabled: true,
      source: 'JS_X_OPS_PROXY',
      host: '127.0.0.1:1080',
      protocol: 'socks5',
    });
  });
});

test('getProxyDispatcher creates ProxyAgent for HTTP proxy', async () => {
  await withProxyEnv({
    JS_X_OPS_PROXY: 'http://127.0.0.1:7890',
  }, () => {
    const dispatcher = getProxyDispatcher();
    assert.ok(dispatcher);
    assert.equal(dispatcher.constructor.name, 'ProxyAgent');
    assert.equal(getProxyInfo().enabled, true);
    assert.equal(getProxyInfo().host, '127.0.0.1:7890');
    assert.equal(getProxyInfo().protocol, 'http');
  });
});

test('getProxyDispatcher returns cached instance for same proxy URL', async () => {
  await withProxyEnv({
    JS_X_OPS_PROXY: 'socks5://127.0.0.1:1080',
  }, () => {
    const first = getProxyDispatcher();
    const second = getProxyDispatcher();
    assert.equal(first, second);
  });
});

test('OfficialApiClient.checkReadAccess adds hint when fetch fails without proxy', async () => {
  const { OfficialApiClient } = require('../lib/official-api/client');

  await withProxyEnv({}, async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    try {
      const client = new OfficialApiClient({
        apiKey: 'key',
        apiSecret: 'secret',
        accessToken: 'token',
        accessTokenSecret: 'token_secret',
      });
      client._readAvailable = null;
      const result = await client.checkReadAccess();
      assert.equal(result.available, false);
      assert.match(result.reason, /fetch failed/);
      assert.match(result.hint, /JS_X_OPS_PROXY/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('api status payload includes proxy summary from getProxyInfo', async () => {
  await withProxyEnv({
    JS_X_OPS_PROXY: 'socks5://user:secret@127.0.0.1:1080',
  }, () => {
    assert.deepEqual(getProxyInfo(), {
      enabled: true,
      source: 'JS_X_OPS_PROXY',
      host: '127.0.0.1:1080',
      protocol: 'socks5',
    });
  });
});
