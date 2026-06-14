'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildTryOrder, FALLBACK_ERRORS } = require('../lib/runTool');
const { parseArgv, COMMANDS } = require('../lib/commands');
const { frontUrl, itemUrl, userUrl } = require('../lib/toolTargets');
const { getPageProfile, PAGE_PROFILES } = require('../lib/config');

describe('buildTryOrder', () => {
  it('auto prefers api then dom for front', () => {
    const order = buildTryOrder('getFrontPage', 'auto', { domSupported: true, apiSupported: true });
    assert.deepEqual(order, ['api_getFrontPage', 'getFrontPage', 'dom_getFrontPage']);
  });

  it('api mode skips dom', () => {
    const order = buildTryOrder('getItem', 'api', { domSupported: true, apiSupported: true });
    assert.deepEqual(order, ['api_getItem', 'getItem']);
  });

  it('search has no dom path', () => {
    const order = buildTryOrder('search', 'auto', { domSupported: false, apiSupported: true });
    assert.deepEqual(order, ['api_search', 'search']);
  });
});

describe('FALLBACK_ERRORS', () => {
  it('includes fetch failures', () => {
    assert.ok(FALLBACK_ERRORS.has('fetch_item_failed'));
    assert.ok(FALLBACK_ERRORS.has('algolia_fetch_failed'));
  });
});

describe('parseArgv', () => {
  it('parses front command flags', () => {
    const { opts, positional } = parseArgv(['--feed', 'new', '--limit', '5', '--pretty']);
    assert.equal(positional.length, 0);
    assert.equal(opts.feed, 'new');
    assert.equal(opts.limit, '5');
    assert.equal(opts.pretty, true);
  });

  it('parses item positional id', () => {
    const { opts, positional } = parseArgv(['12345', '--depth', '3']);
    assert.equal(positional[0], '12345');
    assert.equal(opts.depth, '3');
  });
});

describe('toolTargets', () => {
  it('builds item url', () => {
    assert.equal(itemUrl({ itemId: 42 }), 'https://news.ycombinator.com/item?id=42');
  });

  it('builds front url with page', () => {
    assert.equal(frontUrl({ feed: 'new', page: 2 }), 'https://news.ycombinator.com/newest?p=2');
  });

  it('builds user url with comments tab', () => {
    assert.equal(userUrl({ userId: 'dang', tab: 'comments' }),
      'https://news.ycombinator.com/user?id=dang&sort=comments');
  });
});

describe('config', () => {
  it('has four page profiles', () => {
    assert.equal(Object.keys(PAGE_PROFILES).length, 4);
    assert.ok(getPageProfile('item').bridgeGlobal === '__jse_hn_item__');
  });
});

describe('COMMANDS', () => {
  it('registers core tools', () => {
    assert.ok(COMMANDS.front.toolName === 'hn_get_front_page');
    assert.ok(COMMANDS.search.toolName === 'hn_search');
    assert.ok(COMMANDS['navigate-item'].kind === 'navigate');
  });
});
