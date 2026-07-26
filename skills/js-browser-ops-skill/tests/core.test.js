'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateClickScript,
  generateFillFormScript,
  generateReadPageScript,
} = require('../lib/browserUtils');
const { hostMatches, normalizeHost } = require('../lib/egressAllowlist');
const definition = require('../skill.definition');

test('egress host normalization and wildcard matching are boundary-safe', () => {
  assert.equal(normalizeHost('https://Docs.Example.com/a'), 'docs.example.com');
  assert.equal(normalizeHost('docs.example.com'), 'docs.example.com');
  assert.equal(normalizeHost('https://localhost:18080/a'), 'localhost');
  assert.equal(hostMatches('docs.example.com', '*.example.com'), true);
  assert.equal(hostMatches('example.com', '*.example.com'), false);
  assert.equal(hostMatches('badexample.com', '*.example.com'), false);
});

test('generated scripts safely serialize caller-controlled values', () => {
  const read = generateReadPageScript({ format: 'markdown' });
  const click = generateClickScript({ selector: "button[data-x=\"'\\\\\"]" });
  const fill = generateFillFormScript({ selector: '#q', value: '</script>\\nhello' });
  assert.doesNotThrow(() => new Function(read));
  assert.doesNotThrow(() => new Function(click));
  assert.doesNotThrow(() => new Function(fill));
});

test('definition keeps interaction risks and capabilities explicit', () => {
  const tools = new Map(definition.TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
  assert.equal(tools.get('browser_read_page').risk, 'read');
  assert.equal(tools.get('browser_click').risk, 'interactive');
  assert.ok(tools.get('browser_click').capabilities.includes('browser.page.interact'));
  assert.ok(tools.get('browser_screenshot').capabilities.includes('browser.screenshot'));
});
