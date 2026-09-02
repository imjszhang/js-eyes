'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgv, COMMANDS } = require('../lib/commands');

describe('parseArgv', () => {
  it('parses search flags', () => {
    const { opts, positional } = parseArgv(['nodejs', '--limit', '5', '--max-pages', '2', '--pretty']);
    assert.equal(positional[0], 'nodejs');
    assert.equal(opts.limit, '5');
    assert.equal(opts.maxPages, '2');
    assert.equal(opts.pretty, true);
  });

  it('parses scholar and news options', () => {
    const { opts } = parseArgv(['--year-from', '2017', '--sort-by', 'date', '--time-range', 'w', '--vertical', 'scholar']);
    assert.equal(opts.yearFrom, '2017');
    assert.equal(opts.sortBy, 'date');
    assert.equal(opts.timeRange, 'w');
    assert.equal(opts.vertical, 'scholar');
  });

  it('rejects unknown flags', () => {
    assert.throws(() => parseArgv(['--nope']), /unknown option/);
  });
});

describe('COMMANDS', () => {
  it('registers read and navigate tools', () => {
    assert.equal(COMMANDS.search.toolName, 'google_search');
    assert.equal(COMMANDS.news.toolName, 'google_search_news');
    assert.equal(COMMANDS.images.toolName, 'google_search_images');
    assert.equal(COMMANDS.scholar.toolName, 'google_search_scholar');
    assert.equal(COMMANDS['navigate-search'].kind, 'navigate');
    assert.equal(COMMANDS.search.forceNewTab, true);
    assert.equal(COMMANDS['navigate-search'].kind, 'navigate');
  });
});
