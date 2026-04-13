'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseSkillFrontmatter } = require('../packages/devtools/lib/builder');
const { getOpenClawConfigPath } = require('../packages/protocol/skills');

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
