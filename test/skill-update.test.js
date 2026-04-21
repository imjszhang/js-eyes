'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const archiver = require('archiver');

const { compareSemver, parseSemver, commandSkills } = require('../apps/cli/src/cli');
const { setConfigValue } = require('@js-eyes/config');

describe('compareSemver / parseSemver', () => {
  it('parses standard x.y.z strings', () => {
    assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseSemver('v10.0.4'), [10, 0, 4]);
    assert.deepEqual(parseSemver('2.1.0-beta.1'), [2, 1, 0]);
    assert.equal(parseSemver('not a version'), null);
    assert.equal(parseSemver(null), null);
  });

  it('orders versions correctly', () => {
    assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
    assert.equal(compareSemver('1.0.0', '1.0.1'), -1);
    assert.equal(compareSemver('1.0.1', '1.0.0'), 1);
    assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
    assert.equal(compareSemver('1.2.3', '1.2.10'), -1);
    assert.equal(compareSemver('v2.5.2', '2.5.1'), 1);
  });

  it('treats unparseable strings as smaller than any parseable version', () => {
    assert.equal(compareSemver(null, '1.0.0'), -1);
    assert.equal(compareSemver('1.0.0', undefined), 1);
    assert.equal(compareSemver(null, null), 0);
  });
});

function zipDir(srcDir) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('data', (c) => chunks.push(c));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.glob('**/*', { cwd: srcDir, dot: false });
    archive.finalize();
  });
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function writeFixtureSkill(dir, id, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${id}`,
      `description: fixture skill`,
      `version: ${version}`,
      '---',
      '',
      `# ${id}`,
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: id, version }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'skill.contract.js'),
    `module.exports = { id: '${id}', name: '${id}', version: '${version}', openclaw: { tools: [] }, createOpenClawAdapter() { return { runtime: {}, tools: [] }; } };`,
    'utf8',
  );
}

async function withTempRegistry({ skillId, version, parentVersion, minParentVersion }) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-fixture-'));
  writeFixtureSkill(stage, skillId, version);
  const zipBuffer = await zipDir(stage);
  const hash = sha256(zipBuffer);
  fs.rmSync(stage, { recursive: true, force: true });

  const server = http.createServer((req, res) => {
    if (req.url === '/skills.json') {
      const payload = {
        version: 1,
        generated: new Date().toISOString(),
        parentSkill: { id: 'js-eyes', version: parentVersion || '2.5.2' },
        skills: [
          {
            id: skillId,
            name: skillId,
            description: 'fixture',
            version,
            downloadUrl: `http://127.0.0.1:${server.address().port}/skill.zip`,
            sha256: hash,
            size: zipBuffer.length,
            tools: [],
            commands: [],
            minParentVersion: minParentVersion || '0.0.1',
            releasedAt: new Date().toISOString(),
            changelogUrl: null,
          },
        ],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    if (req.url === '/skill.zip') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(zipBuffer);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    registryUrl: `${base}/skills.json`,
    close: () => new Promise((resolve) => server.close(resolve)),
    hash,
  };
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  const chunks = [];
  process.stdout.write = (chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };
  console.log = () => {};
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
  return chunks.join('');
}

describe('js-eyes skills update via CLI', () => {
  const SKILL_ID = 'fixture-update-skill';
  let originalHome = null;
  let tmpHome = null;

  beforeEach(() => {
    originalHome = process.env.JS_EYES_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-update-'));
    process.env.JS_EYES_HOME = tmpHome;
    setConfigValue('security.requireLockfile', false);
  });

  afterEach(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
    tmpHome = null;
    if (originalHome === undefined) delete process.env.JS_EYES_HOME;
    else process.env.JS_EYES_HOME = originalHome;
  });

  it('upgrades an older local skill to the registry version', async () => {
    const skillsDir = path.join(tmpHome, 'skills');
    writeFixtureSkill(path.join(skillsDir, SKILL_ID), SKILL_ID, '1.0.0');

    const mock = await withTempRegistry({ skillId: SKILL_ID, version: '1.1.0' });
    let output = '';
    try {
      output = await captureStdout(() =>
        commandSkills(['skills', 'update', SKILL_ID], { registry: mock.registryUrl }),
      );
    } finally {
      await mock.close();
    }

    const installed = JSON.parse(
      fs.readFileSync(path.join(skillsDir, SKILL_ID, 'package.json'), 'utf8'),
    );
    assert.equal(installed.version, '1.1.0');
    const integrity = JSON.parse(
      fs.readFileSync(path.join(skillsDir, SKILL_ID, '.integrity.json'), 'utf8'),
    );
    assert.equal(integrity.bundleSha256, mock.hash);
    assert.match(output, /upgrading 1\.0\.0 -> 1\.1\.0/);
  });

  it('reports already up-to-date when local matches registry', async () => {
    const skillsDir = path.join(tmpHome, 'skills');
    writeFixtureSkill(path.join(skillsDir, SKILL_ID), SKILL_ID, '1.2.0');

    const mock = await withTempRegistry({ skillId: SKILL_ID, version: '1.2.0' });
    let output = '';
    try {
      output = await captureStdout(() =>
        commandSkills(['skills', 'update', SKILL_ID], { registry: mock.registryUrl }),
      );
    } finally {
      await mock.close();
    }

    assert.match(output, /already up to date \(1\.2\.0\)/);
  });

  it('blocks update when minParentVersion is not satisfied', async () => {
    const skillsDir = path.join(tmpHome, 'skills');
    writeFixtureSkill(path.join(skillsDir, SKILL_ID), SKILL_ID, '1.0.0');

    // minParentVersion is compared against the CLI's own package.json version (the installed
    // parent skill), not against registry.parentSkill.version. Pick a value no real build will
    // satisfy to force the block deterministically.
    const mock = await withTempRegistry({
      skillId: SKILL_ID,
      version: '2.0.0',
      parentVersion: '1.0.0',
      minParentVersion: '99.0.0',
    });

    const previousExitCode = process.exitCode;
    let output = '';
    try {
      output = await captureStdout(() =>
        commandSkills(['skills', 'update', SKILL_ID], { registry: mock.registryUrl }),
      );
    } finally {
      await mock.close();
    }

    assert.match(output, /BLOCKED \(requires parent js-eyes >= 99\.0\.0/);
    assert.equal(process.exitCode, 2);
    process.exitCode = previousExitCode;

    const stillInstalled = JSON.parse(
      fs.readFileSync(path.join(skillsDir, SKILL_ID, 'package.json'), 'utf8'),
    );
    assert.equal(stillInstalled.version, '1.0.0');
  });

  it('dry-run does not mutate the installed skill', async () => {
    const skillsDir = path.join(tmpHome, 'skills');
    writeFixtureSkill(path.join(skillsDir, SKILL_ID), SKILL_ID, '1.0.0');

    const mock = await withTempRegistry({ skillId: SKILL_ID, version: '1.5.0' });
    let output = '';
    try {
      output = await captureStdout(() =>
        commandSkills(
          ['skills', 'update', SKILL_ID],
          { registry: mock.registryUrl, 'dry-run': true },
        ),
      );
    } finally {
      await mock.close();
    }

    const installed = JSON.parse(
      fs.readFileSync(path.join(skillsDir, SKILL_ID, 'package.json'), 'utf8'),
    );
    assert.equal(installed.version, '1.0.0', 'dry-run must not overwrite local files');
    assert.match(output, /dry-run: staged at/);
  });

  it('list shows updateAvailable flag and hint line', async () => {
    const skillsDir = path.join(tmpHome, 'skills');
    writeFixtureSkill(path.join(skillsDir, SKILL_ID), SKILL_ID, '1.0.0');

    const mock = await withTempRegistry({ skillId: SKILL_ID, version: '1.1.0' });
    let output = '';
    try {
      output = await captureStdout(() =>
        commandSkills(['skills', 'list'], { registry: mock.registryUrl, json: true }),
      );
    } finally {
      await mock.close();
    }

    const parsed = JSON.parse(output);
    const fixture = parsed.skills.find((s) => s.id === SKILL_ID);
    assert.ok(fixture, 'fixture skill should appear in list payload');
    assert.equal(fixture.updateAvailable, true);
    assert.equal(fixture.latestVersion, '1.1.0');
  });
});
