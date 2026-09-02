'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../skill.definition');
const pkg = require('../package.json');

describe('V2 contract', () => {
  it('exports capabilities, requirements, and tools', () => {
    assert.equal(contract.id, 'js-google-ops-skill');
    assert.equal(contract.version, pkg.version);
    assert.ok(contract.capabilities);
    assert.ok(contract.requirements);
    assert.equal(contract.requirements.login, false);
    assert.deepEqual(contract.requirements.platforms, ['google.com', 'scholar.google.com']);
    assert.equal(contract.capabilities.network.direct, false);
    assert.ok(Array.isArray(contract.TOOL_DEFINITIONS));
  });

  it('declares the expected tools with risks and min capabilities', () => {
    const names = contract.TOOL_DEFINITIONS.map((tool) => tool.name);
    assert.deepEqual(names, [
      'google_search',
      'google_search_news',
      'google_search_images',
      'google_search_scholar',
      'google_session_state',
      'google_navigate_search',
    ]);
    for (const tool of contract.TOOL_DEFINITIONS) {
      assert.ok(['read', 'interactive'].includes(tool.risk), tool.name);
      assert.equal(tool.destructive, false, tool.name);
      assert.ok(Array.isArray(tool.capabilities) && tool.capabilities.length >= 3, tool.name);
      assert.ok(tool.capabilities.includes('browser.script.execute'), tool.name);
    }
    const nav = contract.TOOL_DEFINITIONS.find((tool) => tool.name === 'google_navigate_search');
    assert.equal(nav.risk, 'interactive');
    assert.equal(nav.interactive, true);
  });
});
