'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const devtoolsRoot = path.join(repoRoot, 'packages/devtools/lib');

describe('devtools builder module boundaries', () => {
  it('keeps builder.js as a small compatibility facade', () => {
    const source = fs.readFileSync(path.join(devtoolsRoot, 'builder.js'), 'utf8');
    assert.ok(source.split('\n').length <= 50);
    assert.deepEqual(Object.keys(require('../packages/devtools/lib/builder')).sort(), [
      'MAIN_SKILL_STAGE_DIR',
      'buildChrome',
      'buildFirefox',
      'buildSite',
      'buildSkillZip',
      'bump',
      'getVersion',
      'parseSkillFrontmatter',
      'prepareMainSkillBundleStage',
    ].sort());
  });

  it('keeps build responsibilities isolated without reverse facade imports', () => {
    const modules = [
      'context.js',
      'extensions.js',
      'site.js',
      'skill-bundle.js',
      'skills-registry.js',
      'versioning.js',
    ];
    for (const file of modules) {
      const source = fs.readFileSync(path.join(devtoolsRoot, 'build', file), 'utf8');
      assert.ok(source.split('\n').length <= 700, `${file} became a new hotspot`);
      assert.doesNotMatch(source, /require\(['"][^'"]*builder['"]\)/);
    }
  });

  it('resolves build paths and version from the repository root', () => {
    const context = require('../packages/devtools/lib/build/context');
    assert.equal(context.PROJECT_ROOT, repoRoot);
    assert.equal(context.getVersion(), require('../package.json').version);
    assert.equal(
      context.MAIN_SKILL_STAGE_DIR,
      path.join(repoRoot, 'dist', 'skill-bundle', 'js-eyes'),
    );
  });
});
