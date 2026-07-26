'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const EXTENSIONS_ROOT = path.join(ROOT, 'extensions');

const CAPABILITY_MARKERS = {
  'tabs.read': 'handleGetTabsRequest',
  'page.read': 'handleGetHtmlRequest',
  navigation: 'handleOpenUrl',
  'page.interact': 'handleClick',
  'script.execute': 'handleExecuteScript',
  screenshot: 'handleCaptureScreenshot',
  'cookies.read': 'handleGetCookies',
};

function readSources(platform) {
  const roots = [
    path.join(EXTENSIONS_ROOT, 'shared'),
    path.join(EXTENSIONS_ROOT, platform, 'background'),
  ];
  const files = [];
  for (const root of roots) {
    for (const name of fs.readdirSync(root)) {
      if (name.endsWith('.js')) files.push(fs.readFileSync(path.join(root, name), 'utf8'));
    }
  }
  return files.join('\n');
}

function browserSkills() {
  return fs.readdirSync(SKILLS_ROOT)
    .filter((name) => fs.existsSync(path.join(SKILLS_ROOT, name, 'skill.manifest.json')))
    .map((name) => ({
      name,
      manifest: require(path.join(SKILLS_ROOT, name, 'skill.manifest.json')),
    }))
    .filter(({ manifest }) => manifest.requirements.browserExtension)
    .sort((a, b) => a.name.localeCompare(b.name));
}

test('official browser skills have a complete Chrome/Firefox capability matrix', () => {
  const skills = browserSkills();
  assert.equal(skills.length, 9);

  for (const platform of ['chrome', 'firefox']) {
    const manifest = require(path.join(EXTENSIONS_ROOT, platform, 'manifest.json'));
    const source = readSources(platform);
    for (const { name, manifest: skill } of skills) {
      for (const capability of skill.capabilities.browser) {
        const marker = CAPABILITY_MARKERS[capability];
        assert.ok(marker, `${name}/${platform}: unmapped capability ${capability}`);
        assert.match(source, new RegExp(`\\b${marker}\\b`), `${name}/${platform}/${capability}`);
      }
    }

    if (platform === 'chrome') {
      assert.ok(Number(manifest.minimum_chrome_version) >= 135);
      assert.ok(manifest.permissions.includes('userScripts'));
      assert.match(source, /userScripts\.execute/);
    } else {
      assert.ok(Number.parseFloat(manifest.browser_specific_settings.gecko.strict_min_version) >= 58);
      assert.match(source, /tabs\.executeScript/);
    }
  }
});
