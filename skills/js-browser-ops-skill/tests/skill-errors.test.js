'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { readPage } = require('../lib/api');
const { PolicyDeniedError } = require('../lib/egressAllowlist');
const { TabOwnershipError } = require('../lib/tabSession');
const {
  ERROR_TABLE,
  SkillError,
  classifyReadResult,
  emitCliError,
  mapThrownError,
  toErrorEnvelope,
  toErrorPayload,
  toSkillError,
} = require('../lib/skillError');

const LONG_BODY = 'Readable article body with enough characters to pass the default eighty-character minimum.';

function allowlistedOptions(host = 'example.com') {
  return {
    autoAllowDomain: false,
    recordingMode: 'off',
    loadConfig: () => ({ security: { egressAllowlist: [host] } }),
    saveConfig() {
      throw new Error('config must not be written');
    },
    lookup: async () => [{ address: '93.184.216.34' }],
  };
}

function createBrowser(overrides = {}) {
  return {
    serverUrl: 'ws://localhost:18080',
    openUrlCalls: 0,
    executeScriptCalls: 0,
    closedTabs: [],
    tabUrls: new Map(),
    abortedRequests: 0,
    async openUrl(url, tabId, _windowId, options = {}) {
      if (options.signal?.aborted) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }
      this.openUrlCalls += 1;
      const resolved = tabId || (100 + this.openUrlCalls);
      this.tabUrls.set(resolved, url);
      return resolved;
    },
    async closeTab(tabId) {
      this.closedTabs.push(tabId);
    },
    async executeScript(tabId, _script, options = {}) {
      this.executeScriptCalls += 1;
      if (options.signal) {
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            this.abortedRequests += 1;
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (options.signal.aborted) {
            onAbort();
            return;
          }
          options.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return {
        title: 'ok',
        content: LONG_BODY,
        url: this.tabUrls.get(tabId),
      };
    },
    ...overrides,
  };
}

test('error table documents retryability for every required code', () => {
  const expected = {
    invalid_params: false,
    policy_denied: false,
    skill_not_found: false,
    client_not_connected: false,
    tab_not_found: false,
    navigation_failed: true,
    timeout: true,
    blocked_by_site: true,
    rate_limited: true,
    csp_blocked: false,
    eval_denied: false,
    content_too_short: true,
    cancelled: false,
  };
  for (const [code, retryable] of Object.entries(expected)) {
    assert.equal(ERROR_TABLE[code].retryable, retryable, code);
    const error = toSkillError(code, code);
    assert.equal(error.retryable, retryable);
    assert.deepEqual(Object.keys(toErrorPayload(error)).sort().filter((key) => key !== 'retryAfterMs' && key !== 'host'), [
      'code',
      'details',
      'message',
      'retryable',
    ]);
  }
});

test('toSkillError fills retryAfterMs on rate_limited', () => {
  const defaulted = toSkillError('rate_limited', 'slow down');
  assert.equal(defaulted.retryAfterMs, 30000);
  const custom = toSkillError('rate_limited', 'slow down', { retryAfterMs: 15000, host: 'example.com' });
  assert.equal(custom.retryAfterMs, 15000);
  assert.deepEqual(toErrorEnvelope(custom), {
    ok: false,
    error: {
      code: 'rate_limited',
      message: 'slow down',
      retryable: true,
      retryAfterMs: 15000,
      host: 'example.com',
      details: {},
    },
  });
});

test('mapThrownError produces each required code from its production condition', () => {
  const cases = [
    ['invalid_params', new Error('必须提供 url 或 tabId')],
    ['policy_denied', new PolicyDeniedError('denied', { reason: 'not_allowlisted', host: 'evil.example' })],
    ['skill_not_found', new Error('技能未找到: js-zhihu-ops-skill')],
    ['client_not_connected', new Error('No connected extension')],
    ['tab_not_found', new TabOwnershipError('Tab 9 is not owned', { tabId: 9 })],
    ['tab_not_found', new Error('tab 12 not found')],
    ['navigation_failed', new Error('无法在标签 7 内导航到 https://example.com')],
    ['timeout', new Error('请求超时: action=execute_script')],
    ['blocked_by_site', new Error('Cloudflare challenge')],
    ['rate_limited', Object.assign(new Error('HTTP 429 Too Many Requests retry-after: 12'), { retryAfterMs: 12000 })],
    ['csp_blocked', new Error('Blocked by Content Security Policy')],
    ['eval_denied', Object.assign(new Error('allowRawEval is disabled'), { code: 'RAW_EVAL_DISABLED' })],
    ['content_too_short', Object.assign(new Error('shorter than the minimum'), { code: 'content_too_short' })],
    ['cancelled', Object.assign(new Error('Aborted'), { name: 'AbortError' })],
  ];

  for (const [code, thrown] of cases) {
    const mapped = mapThrownError(thrown);
    assert.equal(mapped.code, code, `${code} from ${thrown.message}`);
    assert.equal(mapped.retryable, ERROR_TABLE[code].retryable, code);
    if (code === 'rate_limited') assert.equal(mapped.retryAfterMs, 12000);
  }
});

test('classifyReadResult maps blocked and short pages to structured errors', () => {
  const blocked = classifyReadResult({
    status: 'blocked',
    blockedReason: 'cloudflare_challenge',
    finalUrl: 'https://news.example/paywall',
  });
  assert.equal(blocked.code, 'blocked_by_site');
  assert.equal(blocked.retryable, true);
  assert.equal(blocked.host, 'news.example');

  const short = classifyReadResult({
    status: 'content_too_short',
    contentChars: 12,
    finalUrl: 'https://example.com/empty',
  }, { minContentChars: 80 });
  assert.equal(short.code, 'content_too_short');
  assert.equal(short.retryable, true);

  const limited = classifyReadResult({
    title: '429 Too Many Requests',
    content: 'rate limit',
    url: 'https://api.example/x',
  });
  assert.equal(limited.code, 'rate_limited');
  assert.equal(limited.retryAfterMs, 30000);
});

test('CLI --json emits the same error envelope', () => {
  const lines = [];
  const code = emitCliError(toSkillError('skill_not_found', '技能未找到: demo-skill'), {
    json: true,
    stdout: (line) => lines.push(line),
    stderr: () => {
      throw new Error('stderr must stay quiet for --json');
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    ok: false,
    error: {
      code: 'skill_not_found',
      message: '技能未找到: demo-skill',
      retryable: false,
      details: {},
    },
  });
});

test('readPage throws invalid_params when url and tabId are missing', async () => {
  await assert.rejects(
    () => readPage(createBrowser(), { format: 'text' }, { recordingMode: 'off' }),
    (error) => error instanceof SkillError && error.code === 'invalid_params',
  );
});

test('readPage maps policy denial and rate-limit extract failures', async () => {
  await assert.rejects(
    () => readPage(createBrowser(), { url: 'https://evil.example/x', format: 'text' }, {
      recordingMode: 'off',
      loadConfig: () => ({ security: { egressAllowlist: [] } }),
      saveConfig() {},
      lookup: async () => [{ address: '93.184.216.34' }],
    }),
    (error) => error.code === 'policy_denied' && error.retryable === false,
  );

  const limited = createBrowser({
    async extractPage() {
      const error = new Error('HTTP 429 Too Many Requests');
      error.retryAfterMs = 45000;
      throw error;
    },
    async executeScript() {
      return { probePage: true, readyState: 'complete', contentChars: 200, href: 'https://example.com/rl', hasSelector: true };
    },
  });
  await assert.rejects(
    () => readPage(limited, { url: 'https://example.com/rl', format: 'text' }, allowlistedOptions()),
    (error) => error.code === 'rate_limited' && error.retryAfterMs === 45000 && error.host === 'example.com',
  );
});

test('readPage maps eval_denied and client_not_connected', async () => {
  const evalDenied = createBrowser({
    async extractPage() {
      const error = new Error('RAW_EVAL_DISABLED: allowRawEval is false');
      error.code = 'RAW_EVAL_DISABLED';
      throw error;
    },
    async executeScript() {
      return { probePage: true, readyState: 'complete', contentChars: 200, href: 'https://example.com/eval', hasSelector: true };
    },
  });
  await assert.rejects(
    () => readPage(evalDenied, { url: 'https://example.com/eval', format: 'text' }, allowlistedOptions()),
    (error) => error.code === 'eval_denied' && error.retryable === false,
  );

  const disconnected = createBrowser({
    async openUrl() {
      throw new Error('No connected extension');
    },
  });
  await assert.rejects(
    () => readPage(disconnected, { url: 'https://example.com/x', format: 'text' }, allowlistedOptions()),
    (error) => error.code === 'client_not_connected',
  );
});

test('cancel aborts the in-flight request and closes self-opened tabs', async () => {
  const browser = createBrowser();
  const controller = new AbortController();
  const pending = readPage(browser, { url: 'https://example.com/slow', format: 'text' }, {
    ...allowlistedOptions(),
    signal: controller.signal,
  });
  await new Promise((resolve) => {
    const tick = () => (browser.executeScriptCalls >= 1 ? resolve() : setImmediate(tick));
    tick();
  });
  controller.abort();
  await assert.rejects(
    () => pending,
    (error) => error.code === 'cancelled' && error.retryable === false,
  );
  assert.ok(browser.abortedRequests >= 1);
  assert.deepEqual(browser.closedTabs, [101]);
});
