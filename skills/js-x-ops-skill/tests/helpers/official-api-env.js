'use strict';

const { resetProxyCacheForTests } = require('../../lib/official-api/httpFetch');

const PROXY_KEYS = [
  'JS_X_OPS_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY',
  'http_proxy', 'ALL_PROXY', 'all_proxy',
];

async function withProxyEnv(env, run) {
  const old = Object.fromEntries(PROXY_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  resetProxyCacheForTests();
  try {
    // Keep the isolated environment until asynchronous requests have settled.
    return await run();
  } finally {
    for (const key of PROXY_KEYS) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
    resetProxyCacheForTests();
  }
}

async function withFetchMock(handler, run) {
  return withProxyEnv({ JS_X_OPS_PROXY: 'off' }, async () => {
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
  });
}

module.exports = { withProxyEnv, withFetchMock };
