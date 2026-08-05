'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveProxyUrl,
  getProxyInfo,
  getProxyDispatcher,
  resetProxyCacheForTests,
  sanitizeProxyHost,
  classifyProxyProtocol,
  normalizeSocks5ProxyUrl,
} = require('../lib/official-api/httpFetch');

function withProxyEnv(env, run) {
  const keys = [
    'JS_X_OPS_PROXY',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  resetProxyCacheForTests();
  try {
    return run();
  } finally {
    for (const k of keys) {
      if (old[k] == null) delete process.env[k];
      else process.env[k] = old[k];
    }
    resetProxyCacheForTests();
  }
}

test('resolveProxyUrl prefers JS_X_OPS_PROXY over HTTPS_PROXY', () => {
  withProxyEnv({
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

test('resolveProxyUrl falls back to HTTPS_PROXY', () => {
  withProxyEnv({
    HTTPS_PROXY: 'http://127.0.0.1:7890',
  }, () => {
    const resolved = resolveProxyUrl();
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:7890',
      source: 'HTTPS_PROXY',
    });
  });
});

test('JS_X_OPS_PROXY=off forces direct and ignores lower-priority proxies', () => {
  withProxyEnv({
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

test('getProxyDispatcher creates Socks5ProxyAgent for SOCKS proxies', () => {
  withProxyEnv({
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

test('getProxyDispatcher creates ProxyAgent for HTTP proxy', () => {
  withProxyEnv({
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

test('getProxyDispatcher returns cached instance for same proxy URL', () => {
  withProxyEnv({
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

test('api status payload includes proxy summary from getProxyInfo', () => {
  withProxyEnv({
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
