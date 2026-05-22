'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

let tempDir = null;
let previousHome = null;

async function loadRegister() {
  const plugin = await import('../openclaw-plugin/index.mjs');
  const entry = plugin.default;
  if (typeof entry === 'function') return entry;
  if (entry && typeof entry.register === 'function') return entry.register;
  throw new Error('plugin entry has no register()');
}

function createFakeApi(pluginConfig = {}, registrationMode = 'full') {
  const tools = [];
  const services = [];
  return {
    registrationMode,
    pluginConfig,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerTool(definition, options) {
      tools.push({ definition, options });
    },
    registerService(service) {
      services.push(service);
    },
    registerCli() {},
    _tools: tools,
    _services: services,
  };
}

function waitForHttpOk(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve(res.statusCode);
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error(`unexpected status ${res.statusCode}`));
          return;
        }
        setTimeout(attempt, 50);
      });
      req.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`timeout waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

describe('openclaw plugin lifecycle', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-openclaw-lifecycle-'));
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

  it('survives double full register and serves HTTP after service start', async () => {
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    const port = 38080 + (process.pid % 2000);
    const register = await loadRegister();
    const pluginConfig = {
      serverHost: '127.0.0.1',
      serverPort: port,
      autoStartServer: true,
      watchConfig: false,
      devWatchSkills: false,
      skillsDir,
    };

    const api1 = createFakeApi(pluginConfig, 'full');
    register(api1);

    const api2 = createFakeApi(pluginConfig, 'full');
    register(api2);

    assert.equal(api1._services.length, 1);
    assert.equal(api2._services.length, 1);

    const service = api2._services[0];
    const ctx = { logger: api2.logger };

    await service.start(ctx);
    await waitForHttpOk(`http://127.0.0.1:${port}/api/browser/status`);

    await service.stop(ctx);
  });

  it('skips registerService in discovery mode', async () => {
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    const register = await loadRegister();
    const api = createFakeApi(
      {
        autoStartServer: true,
        watchConfig: false,
        devWatchSkills: false,
        skillsDir,
      },
      'discovery',
    );

    register(api);

    assert.equal(api._services.length, 0);
    assert.equal(api._tools.length, 1);
  });

  it('returns a clear skill registry unavailable message after teardown', async () => {
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    const register = await loadRegister();
    const api = createFakeApi(
      {
        autoStartServer: false,
        watchConfig: false,
        devWatchSkills: false,
        skillsDir,
      },
      'full',
    );

    register(api);
    const tool = api._tools[0].definition;
    const service = api._services[0];

    await service.stop({ logger: api.logger });

    const result = await tool.execute('t-registry-missing', {
      action: 'skill/js-browser-ops-skill/browser_screenshot',
      args: { tabId: 1 },
    });

    assert.match(result.content[0].text, /skill registry 当前不可用/);
    assert.match(result.content[0].text, /browser_screenshot/);
  });
});
