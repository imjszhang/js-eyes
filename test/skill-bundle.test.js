'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseSkillFrontmatter } = require('../packages/devtools/lib/builder');
const {
  discoverLocalSkills,
  getLegacyOpenClawSkillState,
  getOpenClawConfigPath,
  isSkillEnabled,
  registerOpenClawTools,
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

describe('OpenClaw config path resolution', () => {
  it('prefers OPENCLAW_CONFIG_PATH', () => {
    const resolved = getOpenClawConfigPath({
      env: {
        OPENCLAW_CONFIG_PATH: '/tmp/custom-openclaw.json',
        OPENCLAW_STATE_DIR: '/tmp/state-dir',
        OPENCLAW_HOME: '/tmp/openclaw-home',
      },
      home: '/tmp/fallback-home',
    });
    assert.equal(resolved, path.resolve('/tmp/custom-openclaw.json'));
  });

  it('falls back to OPENCLAW_STATE_DIR when config path is unset', () => {
    const resolved = getOpenClawConfigPath({
      env: {
        OPENCLAW_STATE_DIR: '/tmp/state-dir',
      },
      home: '/tmp/fallback-home',
    });
    assert.equal(resolved, path.resolve('/tmp/state-dir', 'openclaw.json'));
  });

  it('falls back to OPENCLAW_HOME and then default home path', () => {
    const fromHome = getOpenClawConfigPath({
      env: {
        OPENCLAW_HOME: '/tmp/openclaw-home',
      },
      home: '/tmp/fallback-home',
    });
    assert.equal(fromHome, path.resolve('/tmp/openclaw-home', '.openclaw', 'openclaw.json'));

    const defaultPath = getOpenClawConfigPath({
      env: {},
      home: '/tmp/fallback-home',
    });
    assert.equal(defaultPath, path.join('/tmp/fallback-home', '.openclaw', 'openclaw.json'));
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

  it('falls back to legacy OpenClaw plugin entries when JS Eyes host state is unset', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-openclaw-state-'));
    const openclawConfigPath = path.join(tempDir, 'openclaw.json');
    fs.writeFileSync(openclawConfigPath, JSON.stringify({
      plugins: {
        entries: {
          'js-eyes': { enabled: true },
          'js-x-ops-skill': { enabled: false },
          'js-youtube-ops-skill': { enabled: true },
        },
      },
    }, null, 2));

    const legacyState = getLegacyOpenClawSkillState({
      openclawConfigPath,
      skillIds: ['js-x-ops-skill', 'js-youtube-ops-skill'],
    });

    assert.equal(isSkillEnabled({}, 'js-x-ops-skill', legacyState), false);
    assert.equal(isSkillEnabled({}, 'js-youtube-ops-skill', legacyState), true);
    assert.equal(isSkillEnabled({}, 'js-wechat-ops-skill', legacyState), true);
    assert.equal(isSkillEnabled({ skillsEnabled: { 'js-x-ops-skill': true } }, 'js-x-ops-skill', legacyState), true);
  });

  it('discovers local skills and registers tools with duplicate protection', () => {
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

    const registrations = [];
    const summary = registerOpenClawTools({
      logger: { warn() {}, info() {} },
      registerTool(definition) {
        registrations.push(definition.name);
      },
    }, {
      tools: [
        { name: 'mock_tool', label: 'Mock Tool', description: 'ok', parameters: { type: 'object', properties: {} }, execute() {} },
        { name: 'mock_tool', label: 'Mock Tool Duplicate', description: 'duplicate', parameters: { type: 'object', properties: {} }, execute() {} },
      ],
    }, {
      sourceName: skill.id,
      registeredNames: new Set(),
      logger: { warn() {}, info() {} },
    });

    assert.deepEqual(registrations, ['mock_tool']);
    assert.deepEqual(summary.registered, ['mock_tool']);
    assert.equal(summary.skipped.length, 1);
  });
});
