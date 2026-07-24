'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { setConfigValue } = require('../packages/config');

let tempDir = null;
let previousHome = null;

async function loadRegister() {
  const plugin = await import('../openclaw-plugin/index.mjs');
  const entry = plugin.default;
  if (typeof entry === 'function') return entry;
  if (entry && typeof entry.register === 'function') return entry.register;
  throw new Error('plugin entry has no register()');
}

function createFakeApi(pluginConfig = {}) {
  const tools = [];
  return {
    pluginConfig,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerTool(definition, options) {
      tools.push({ definition, options });
    },
    registerService() {},
    registerCli() {},
    _tools: tools,
  };
}

describe('openclaw plugin single tool router', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-openclaw-single-'));
    previousHome = process.env.JS_EYES_HOME;
    process.env.JS_EYES_HOME = path.join(tempDir, 'home');
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.JS_EYES_HOME;
    } else {
      process.env.JS_EYES_HOME = previousHome;
    }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    previousHome = null;
  });

  it('registers only js-eyes and rejects old js_eyes action names', async () => {
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    const register = await loadRegister();
    const api = createFakeApi({
      autoStartServer: false,
      watchConfig: false,
      devWatchSkills: false,
      skillsDir,
    });

    register(api);

    assert.deepEqual(api._tools.map((entry) => entry.definition.name), ['js-eyes']);

    const tool = api._tools[0].definition;
    const missing = await tool.execute('t-1', {});
    assert.match(missing.content[0].text, /缺少 action/);

    const old = await tool.execute('t-2', { action: 'js_eyes_get_tabs', args: {} });
    assert.match(old.content[0].text, /不支持的 JS Eyes action/);
  });

  it('identifies V2 invocations as coming from OpenClaw', async () => {
    const skillsDir = path.join(tempDir, 'skills');
    const skillDir = path.join(skillsDir, 'source-check');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({
      name: 'source-check',
      version: '1.0.0',
    }));
    fs.writeFileSync(path.join(skillDir, 'skill.manifest.json'), JSON.stringify({
      manifestVersion: 2,
      id: 'source-check',
      name: 'Source Check',
      version: '1.0.0',
      entry: './entry.js',
      capabilities: {},
      tools: [{
        name: 'source_check',
        title: 'Source Check',
        risk: 'read',
        inputSchema: { type: 'object', properties: {} },
      }],
    }));
    fs.writeFileSync(path.join(skillDir, 'entry.js'), `
      module.exports = { handlers: {
        async source_check(ctx) { return { source: ctx.source }; }
      } };
    `);
    setConfigValue('skillsEnabled.source-check', true);

    const register = await loadRegister();
    const api = createFakeApi({
      autoStartServer: false,
      watchConfig: false,
      devWatchSkills: false,
      skillsDir,
    });
    register(api);

    const tool = api._tools[0].definition;
    let result = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      result = await tool.execute('source-call', {
        action: 'skill/source-check/source-check',
        args: {},
      });
      if (result?.structuredContent) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(result.structuredContent.source, 'openclaw');
  });
});
