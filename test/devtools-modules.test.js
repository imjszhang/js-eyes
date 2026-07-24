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
    assert.equal(
      context.MAIN_SKILL_TEMPLATE,
      path.join(repoRoot, 'distribution', 'js-eyes-skill', 'SKILL.template.md'),
    );
    assert.deepEqual(context.SKILL_BUNDLE_FILES, ['SECURITY.md', 'LICENSE']);
  });

  it('renders the distributable parent Skill from its template', () => {
    const { renderMainSkillMarkdown } = require(
      '../packages/devtools/lib/build/skill-bundle',
    );
    const version = require('../package.json').version;
    const rendered = renderMainSkillMarkdown(version);

    assert.match(rendered, /^name: js-eyes$/m);
    assert.match(rendered, new RegExp(`^version: ${version.replaceAll('.', '\\.')}$`, 'm'));
    assert.doesNotMatch(rendered, /__JS_EYES_VERSION__/);
    assert.doesNotMatch(rendered, /\bjs_eyes_/);
    assert.equal(fs.existsSync(path.join(repoRoot, 'SKILL.md')), false);
  });
});
