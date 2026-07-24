'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseSkillFrontmatter } = require('../packages/devtools/lib/builder');
const {
  buildAdapterTools,
  discoverLocalSkills,
  isSkillEnabled,
} = require('../packages/protocol/skills');

describe('skill bundle metadata', () => {
  let tempDir = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('parses single-line JSON metadata from SKILL frontmatter', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-skill-frontmatter-'));
    const skillPath = path.join(tempDir, 'SKILL.md');
    fs.writeFileSync(
      skillPath,
      [
        '---',
        'name: js-eyes',
        'description: Test skill',
        'metadata: {"openclaw":{"os":["darwin","linux","win32"],"requires":{"bins":["node"]}}}',
        '---',
        '',
        '# Test',
        '',
      ].join('\n'),
      'utf8',
    );

    const meta = parseSkillFrontmatter(skillPath);
    assert.equal(meta.name, 'js-eyes');
    assert.deepEqual(meta.metadata.openclaw.os, ['darwin', 'linux', 'win32']);
    assert.deepEqual(meta.metadata.openclaw.requires.bins, ['node']);
  });
});

describe('skill host state compatibility', () => {
  let tempDir = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('discovers local skills and builds host-neutral tools with duplicate protection', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-local-skills-'));
    const skillDir = path.join(tempDir, 'mock-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({
      name: 'mock-skill',
      version: '1.0.0',
    }, null, 2));
    fs.writeFileSync(path.join(skillDir, 'skill.contract.js'), `
module.exports = {
  id: 'mock-skill',
  name: 'Mock Skill',
  version: '1.0.0',
  openclaw: {
    tools: [{ name: 'mock_tool', description: 'mock tool', parameters: { type: 'object', properties: {} } }]
  }
};
`, 'utf8');

    const [skill] = discoverLocalSkills(tempDir);
    assert.equal(skill.id, 'mock-skill');
    assert.deepEqual(skill.actions, ['skill/mock-skill/mock-tool']);

    const { toolDefs, summary } = buildAdapterTools({
      tools: [
        { name: 'mock_tool', label: 'Mock Tool', description: 'ok', parameters: { type: 'object', properties: {} }, execute() {} },
        { name: 'mock_tool', label: 'Mock Tool Duplicate', description: 'duplicate', parameters: { type: 'object', properties: {} }, execute() {} },
      ],
    }, {
      sourceName: skill.id,
      registeredNames: new Set(),
      logger: { warn() {}, info() {} },
    });

    assert.deepEqual(toolDefs.map((entry) => entry.toolName), ['mock_tool']);
    assert.equal(summary.skipped.length, 1);
  });

  it('ignores parent skill docs without a child skill contract', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-parent-skill-doc-'));
    const parentSkillDir = path.join(tempDir, 'js-eyes');
    fs.mkdirSync(parentSkillDir, { recursive: true });
    fs.writeFileSync(path.join(parentSkillDir, 'SKILL.md'), [
      '---',
      'name: js-eyes',
      'description: Parent skill compatibility doc',
      '---',
      '',
      '# JS Eyes',
      '',
    ].join('\n'));

    const childSkillDir = path.join(tempDir, 'mock-skill');
    fs.mkdirSync(childSkillDir, { recursive: true });
    fs.writeFileSync(path.join(childSkillDir, 'package.json'), JSON.stringify({
      name: 'mock-skill',
      version: '1.0.0',
    }, null, 2));
    fs.writeFileSync(path.join(childSkillDir, 'skill.contract.js'), `
module.exports = {
  id: 'mock-skill',
  name: 'Mock Skill',
  version: '1.0.0'
};
`, 'utf8');

    const skills = discoverLocalSkills(tempDir);
    assert.deepEqual(skills.map((skill) => skill.id), ['mock-skill']);
  });

  it('discovers local skills from a relative skills directory path', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-relative-skills-'));
    const skillDir = path.join(tempDir, 'mock-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({
      name: 'mock-skill',
      version: '1.0.0',
    }, null, 2));
    fs.writeFileSync(path.join(skillDir, 'skill.contract.js'), `
module.exports = {
  id: 'mock-skill',
  name: 'Mock Skill',
  version: '1.0.0'
};
`, 'utf8');

    const relativeSkillsDir = path.relative(process.cwd(), tempDir);
    const skills = discoverLocalSkills(relativeSkillsDir);
    assert.deepEqual(skills.map((skill) => skill.id), ['mock-skill']);
  });
});
