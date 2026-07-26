'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PAGE_PROFILES, getPageProfile } = require('../lib/config');
const {
  issueDetailUrl,
  issuesListUrl,
  parseSlug,
  repoRootUrl,
} = require('../lib/toolTargets');
const definition = require('../skill.definition');

test('GitHub target builders encode repository and issue inputs', () => {
  assert.deepEqual(parseSlug('/openai/openai-node/'), { owner: 'openai', repo: 'openai-node' });
  assert.equal(repoRootUrl({ slug: 'openai/openai-node' }), 'https://github.com/openai/openai-node');
  assert.equal(
    issuesListUrl({ owner: 'openai', repo: 'openai-node', q: 'is:open label:bug' }),
    'https://github.com/openai/openai-node/issues?q=is%3Aopen%20label%3Abug',
  );
  assert.equal(
    issueDetailUrl({ owner: 'openai', repo: 'openai-node', number: 42 }),
    'https://github.com/openai/openai-node/issues/42',
  );
});

test('page profiles and tools cover repo, issue list, and issue detail', () => {
  assert.deepEqual(Object.keys(PAGE_PROFILES).sort(), ['issue', 'issues', 'repo']);
  assert.equal(getPageProfile('issue').score({
    url: 'https://github.com/openai/openai-node/issues/42',
    is_active: true,
  }), 1500);
  assert.throws(() => getPageProfile('pulls'), { code: 'E_BAD_ARG' });
  assert.equal(definition.TOOL_DEFINITIONS.length, 7);
});
