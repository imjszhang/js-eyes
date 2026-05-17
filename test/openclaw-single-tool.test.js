'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

let tempDir = null;
let previousHome = null;

async function loadPlugin() {
  const plugin = await import('../openclaw-plugin/index.mjs');
  return plugin.default;
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

    const register = await loadPlugin();
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
});
