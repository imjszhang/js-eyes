'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

test('CLI calls a V2 skill through the shared host runtime', () => {
  const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-skill-call-'));
  try {
    const skillsDir = path.join(runtimeHome, 'skills');
    const skillDir = path.join(skillsDir, 'mock-v2');
    fs.mkdirSync(path.join(runtimeHome, 'config'), { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeHome, 'config', 'config.json'), JSON.stringify({
      skillsDir,
      skillsEnabled: { 'mock-v2': true },
      recording: { mode: 'off' },
    }));
    fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({
      name: 'mock-v2', version: '1.0.0', description: 'CLI fixture',
    }));
    fs.writeFileSync(path.join(skillDir, 'skill.manifest.json'), JSON.stringify({
      manifestVersion: 2,
      id: 'mock-v2',
      name: 'Mock V2',
      version: '1.0.0',
      entry: './skill.entry.js',
      compatibility: { jsEyes: '>=2.8.5 <3', contractApi: '^2.0.0', runtimeApi: '^2.0.0', node: '>=22' },
      requirements: { server: false, browserExtension: false },
      capabilities: {},
      tools: [{
        name: 'echo',
        risk: 'read',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      }],
    }));
    fs.writeFileSync(path.join(skillDir, 'skill.entry.js'), `
module.exports = { handlers: {
  echo: async (ctx, input) => ({ value: input.value, source: ctx.source })
} };
`);

    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'apps/cli/bin/js-eyes.js'),
      'skill', 'call', 'mock-v2', 'echo', '--args', '{"value":7}', '--json',
    ], {
      cwd: ROOT,
      env: { ...process.env, JS_EYES_HOME: runtimeHome },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { value: 7, source: 'cli' });
  } finally {
    fs.rmSync(runtimeHome, { recursive: true, force: true });
  }
});

test('CLI refuses an untrusted external V2 CLI before executing its entry', () => {
  const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-skill-run-trust-'));
  try {
    const skillsDir = path.join(runtimeHome, 'primary');
    const skillDir = path.join(runtimeHome, 'external-v2');
    const marker = path.join(runtimeHome, 'executed.txt');
    fs.mkdirSync(path.join(runtimeHome, 'config'), { recursive: true });
    fs.mkdirSync(skillsDir);
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(runtimeHome, 'config', 'config.json'), JSON.stringify({
      skillsDir,
      extraSkillDirs: [skillDir],
      skillsEnabled: { 'external-v2': true },
      externalSkills: { policy: 'prompt' },
    }));
    fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({
      name: 'external-v2', version: '1.0.0',
    }));
    fs.writeFileSync(path.join(skillDir, 'skill.manifest.json'), JSON.stringify({
      manifestVersion: 2,
      id: 'external-v2', name: 'External V2', version: '1.0.0',
      entry: './entry.js', cli: { entry: './cli.js', commands: [{ name: 'test' }] },
      capabilities: {}, tools: [],
    }));
    fs.writeFileSync(path.join(skillDir, 'entry.js'), 'module.exports = { handlers: {} };\n');
    fs.writeFileSync(path.join(skillDir, 'cli.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes');\n`);
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'apps/cli/bin/js-eyes.js'), 'skill', 'run', 'external-v2', 'test',
    ], {
      cwd: ROOT,
      env: { ...process.env, JS_EYES_HOME: runtimeHome },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /信任无效/);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(runtimeHome, { recursive: true, force: true });
  }
});
