'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveSkillSources,
  discoverSkillsFromSources,
  readSkillByIdFromSources,
  listSkillDirectories,
  discoverLocalSkills,
} = require('../packages/protocol/skills');

const { normalizeConfig } = require('../packages/config');

function writeSkill(dir, id, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: id, version: opts.version || '1.0.0' }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'skill.contract.js'),
    `module.exports = {
  id: '${id}',
  name: '${opts.name || id}',
  version: '${opts.version || '1.0.0'}',
  openclaw: { tools: [{ name: '${opts.tool || `${id.replace(/-/g, '_')}_tool`}', description: 'x', parameters: { type: 'object', properties: {} } }] },
};
`,
    'utf8',
  );
}

describe('resolveSkillSources', () => {
  let tempDir = null;
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('returns empty extras when none provided', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-sources-'));
    const sources = resolveSkillSources({ primary: tempDir });
    assert.equal(sources.primary, path.resolve(tempDir));
    assert.deepEqual(sources.extras, []);
    assert.deepEqual(sources.invalid, []);
  });

  it('classifies single-skill extra as kind=skill and parent-dir extra as kind=dir', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-sources-'));
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });

    const skillExtra = path.join(tempDir, 'my-skill');
    writeSkill(skillExtra, 'my-skill');

    const parentExtra = path.join(tempDir, 'parent');
    fs.mkdirSync(parentExtra, { recursive: true });
    writeSkill(path.join(parentExtra, 'child-a'), 'child-a');
    writeSkill(path.join(parentExtra, 'child-b'), 'child-b');

    const sources = resolveSkillSources({
      primary,
      extras: [skillExtra, parentExtra],
    });
    assert.equal(sources.extras.length, 2);
    assert.equal(sources.extras[0].kind, 'skill');
    assert.equal(sources.extras[0].path, path.resolve(skillExtra));
    assert.equal(sources.extras[1].kind, 'dir');
  });

  it('flags non-existent and non-directory extras as invalid', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-sources-'));
    const filePath = path.join(tempDir, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'hello');

    const sources = resolveSkillSources({
      primary: tempDir,
      extras: [path.join(tempDir, 'missing-dir'), filePath, '', 42],
    });

    assert.equal(sources.extras.length, 0);
    const reasons = sources.invalid.map((e) => e.reason).sort();
    assert.deepEqual(reasons, ['invalid-type', 'invalid-type', 'not-a-directory', 'not-found']);
  });

  it('dedupes extras against primary and against each other', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-sources-'));
    const extra = path.join(tempDir, 'extra');
    fs.mkdirSync(extra, { recursive: true });
    writeSkill(path.join(extra, 'only-skill'), 'only-skill');

    const sources = resolveSkillSources({
      primary: tempDir,
      extras: [tempDir, extra, extra],
    });
    assert.equal(sources.extras.length, 1);
    assert.equal(sources.extras[0].path, path.resolve(extra));
  });

  it('pulls extras from config.extraSkillDirs when extras arg is omitted', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-sources-'));
    const extra = path.join(tempDir, 'cfg-extra');
    fs.mkdirSync(extra, { recursive: true });

    const sources = resolveSkillSources({
      primary: tempDir,
      config: { extraSkillDirs: [extra] },
    });
    assert.equal(sources.extras.length, 1);
    assert.equal(sources.extras[0].path, path.resolve(extra));
  });
});

describe('discoverSkillsFromSources', () => {
  let tempDir = null;
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('returns primary-only skills when no extras', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-disc-'));
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'alpha'), 'alpha');

    const { skills, conflicts } = discoverSkillsFromSources({ primary, extras: [] });
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, 'alpha');
    assert.equal(skills[0].source, 'primary');
    assert.equal(skills[0].sourcePath, path.resolve(primary));
    assert.equal(conflicts.length, 0);
  });

  it('merges primary + single-skill extra + parent-dir extra', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-disc-'));
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'p1'), 'p1');

    const skillExtra = path.join(tempDir, 'ext-skill');
    writeSkill(skillExtra, 'ext-one');

    const parentExtra = path.join(tempDir, 'ext-parent');
    fs.mkdirSync(parentExtra, { recursive: true });
    writeSkill(path.join(parentExtra, 'ext-two'), 'ext-two');

    const sources = resolveSkillSources({
      primary,
      extras: [skillExtra, parentExtra],
    });
    const { skills } = discoverSkillsFromSources(sources);
    const ids = skills.map((s) => s.id).sort();
    assert.deepEqual(ids, ['ext-one', 'ext-two', 'p1']);

    const byId = new Map(skills.map((s) => [s.id, s]));
    assert.equal(byId.get('p1').source, 'primary');
    assert.equal(byId.get('ext-one').source, 'extra');
    assert.equal(byId.get('ext-one').sourcePath, path.resolve(skillExtra));
    assert.equal(byId.get('ext-two').source, 'extra');
    assert.equal(byId.get('ext-two').sourcePath, path.resolve(parentExtra));
  });

  it('resolves conflicts primary-wins and reports via onConflict', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-disc-'));
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'dup'), 'dup', { name: 'PrimaryVersion' });

    const extraParent = path.join(tempDir, 'extras');
    fs.mkdirSync(extraParent, { recursive: true });
    writeSkill(path.join(extraParent, 'dup'), 'dup', { name: 'ExtraVersion' });

    const conflicts = [];
    const { skills } = discoverSkillsFromSources(
      { primary, extras: [{ path: extraParent, kind: 'dir' }] },
      { onConflict: (c) => conflicts.push(c) },
    );

    assert.equal(skills.length, 1);
    assert.equal(skills[0].source, 'primary');
    assert.equal(skills[0].name, 'PrimaryVersion');
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].id, 'dup');
    assert.equal(conflicts[0].winner.source, 'primary');
    assert.equal(conflicts[0].loser.source, 'extra');
  });

  it('tolerates non-existent extra paths (invalid list)', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-disc-'));
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'only'), 'only');

    const sources = resolveSkillSources({
      primary,
      extras: [path.join(tempDir, 'nope')],
    });
    const { skills } = discoverSkillsFromSources(sources);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, 'only');
    assert.equal(sources.invalid.length, 1);
    assert.equal(sources.invalid[0].reason, 'not-found');
  });
});

describe('symlink-to-directory support', () => {
  let tempDir = null;
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('listSkillDirectories follows symlinked directories', function (t) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-sym-'));
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });

    const realSkill = path.join(tempDir, '_real', 'linked-skill');
    writeSkill(realSkill, 'linked-skill');

    const linkPath = path.join(primary, 'linked-skill');
    try {
      fs.symlinkSync(realSkill, linkPath, 'dir');
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        t.skip('symlinks not permitted in this environment');
        return;
      }
      throw err;
    }

    const dirs = listSkillDirectories(primary);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], linkPath);

    const skills = discoverLocalSkills(primary);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, 'linked-skill');
  });
});

describe('readSkillByIdFromSources', () => {
  let tempDir = null;
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('finds primary before extras and returns source metadata', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-read-'));
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'alpha'), 'alpha');

    const extraSkill = path.join(tempDir, 'beta');
    writeSkill(extraSkill, 'beta');

    const sources = resolveSkillSources({ primary, extras: [extraSkill] });

    const a = readSkillByIdFromSources({ id: 'alpha', ...sources });
    assert.equal(a.id, 'alpha');
    assert.equal(a.source, 'primary');

    const b = readSkillByIdFromSources({ id: 'beta', ...sources });
    assert.equal(b.id, 'beta');
    assert.equal(b.source, 'extra');
    assert.equal(b.sourcePath, path.resolve(extraSkill));

    const miss = readSkillByIdFromSources({ id: 'nope', ...sources });
    assert.equal(miss, null);
  });
});

describe('config.extraSkillDirs normalization', () => {
  it('treats string as single-item array', () => {
    const cfg = normalizeConfig({ extraSkillDirs: '/a/b' });
    assert.deepEqual(cfg.extraSkillDirs, ['/a/b']);
  });

  it('coerces non-array/non-string to empty', () => {
    const cfg = normalizeConfig({ extraSkillDirs: 42 });
    assert.deepEqual(cfg.extraSkillDirs, []);
  });

  it('defaults to empty array when unset', () => {
    const cfg = normalizeConfig({});
    assert.deepEqual(cfg.extraSkillDirs, []);
  });

  it('trims and dedupes entries', () => {
    const cfg = normalizeConfig({ extraSkillDirs: ['/x', ' /x ', '', '/y', '/y'] });
    assert.deepEqual(cfg.extraSkillDirs, ['/x', '/y']);
  });
});
