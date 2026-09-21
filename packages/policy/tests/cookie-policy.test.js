'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PolicyContext } = require('..');

function makePolicy(options = {}) {
  return new PolicyContext({
    security: {
      enforcement: options.enforcement || 'soft',
      taskOrigin: { enabled: true, sources: ['user-message'] },
      taint: { enabled: true, mode: 'canary+substring', minValueLength: 6 },
      sensitiveCookieDomains: options.sensitiveCookieDomains || [
        'bank', 'google.com', 'apple.com',
      ],
    },
    userMessages: options.userMessages || ['https://x.com/home'],
  });
}

describe('cookie domain policy', () => {
  it('requires task-origin scope for syncCookies and setCookies', async () => {
    const policy = makePolicy();
    const sync = await policy.evaluate('syncCookies', { domain: 'evil.com', source: 'a', destination: 'b' });
    assert.equal(sync.decision, 'soft-block');
    assert.equal(sync.rule, 'L4a-task-origin');

    const write = await policy.evaluate('setCookies', {
      cookies: [{ name: 'sid', value: 'abc123', domain: 'other.com' }],
    });
    assert.equal(write.decision, 'soft-block');
    assert.equal(write.rule, 'L4a-task-origin');
  });

  it('rejects default sensitive cookie domains', async () => {
    const policy = makePolicy({ userMessages: ['https://google.com'] });
    const result = await policy.evaluate('syncCookies', {
      domain: 'google.com',
      source: 'src',
      destination: 'dst',
    });
    assert.equal(result.decision, 'soft-block');
    assert.equal(result.rule, 'L4c-sensitive-cookie-domain');

    const strict = makePolicy({
      enforcement: 'strict',
      userMessages: ['https://google.com'],
    });
    const denied = await strict.evaluate('getCookiesByDomain', { domain: 'google.com' });
    assert.equal(denied.decision, 'deny');
    assert.equal(denied.rule, 'L4c-sensitive-cookie-domain');
  });

  it('treats setCookies values as a taint sink', async () => {
    const policy = makePolicy();
    const tagged = policy.tagCookiesReturn([{ name: 'sid', value: 'abc123secret' }], { source: 'getCookies' });
    const result = await policy.evaluate('setCookies', {
      domain: 'x.com',
      cookies: [{ name: 'sid', value: tagged[0].value, domain: 'x.com' }],
    });
    assert.equal(result.decision, 'soft-block');
    assert.equal(result.rule, 'L4b-taint');
  });

  it('allows in-scope non-sensitive syncCookies', async () => {
    const policy = makePolicy();
    const result = await policy.evaluate('syncCookies', {
      domain: 'x.com',
      source: 'src',
      destination: 'dst',
    });
    assert.equal(result.decision, 'allow');
  });
});
