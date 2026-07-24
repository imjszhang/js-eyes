'use strict';

const path = require('path');
const { fork } = require('child_process');

const BROWSER_CAPABILITIES = Object.freeze({
  getTabs: 'browser.tabs.read',
  listClients: 'browser.tabs.read',
  openUrl: 'browser.navigation',
  closeTab: 'browser.navigation',
  getTabHtml: 'browser.page.read',
  getPageInfo: 'browser.page.read',
  captureScreenshot: 'browser.screenshot',
  executeScript: 'browser.script.execute',
  injectCss: 'browser.css.inject',
  getCookies: 'browser.cookies.read',
  getCookiesByDomain: 'browser.cookies.read',
  uploadFileToTab: 'browser.files.upload',
});

function safeWorkerEnv(extra = {}) {
  const allowed = [
    'PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP',
    'LANG', 'LC_ALL', 'TZ', 'NODE_PATH',
  ];
  const env = {};
  for (const key of allowed) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value != null) env[key] = String(value);
  }
  return env;
}

function deserializeError(payload) {
  const error = /** @type {Error & {code?: string, retryable?: boolean, safeDetails?: any}} */ (
    new Error(payload?.message || 'Skill worker error')
  );
  error.name = payload?.name || 'SkillWorkerError';
  error.code = payload?.code || 'SKILL_WORKER_ERROR';
  error.retryable = payload?.retryable === true;
  error.safeDetails = payload?.safeDetails || null;
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

function createSkillWorkerBackend(options = {}) {
  const skill = options.skill;
  const runtime = options.runtime;
  const logger = options.logger || console;
  if (!skill?.entryPath || !skill?.descriptor) {
    throw new TypeError('createSkillWorkerBackend requires a V2 skill with entryPath and descriptor');
  }

  const pending = new Map();
  const activeInvocationContexts = new Map();
  let child = null;
  let state = 'created';
  let sequence = 0;

  function nextId(prefix) {
    sequence += 1;
    return `${prefix}-${process.pid}-${sequence}`;
  }

  function sendRequest(type, payload = {}, timeoutMs = options.requestTimeoutMs || 30000) {
    if (!child || !child.connected) return Promise.reject(new Error('Skill worker is not connected'));
    const requestId = nextId(type);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Skill worker request timed out: ${type}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      child.send({ type, requestId, ...payload });
    });
  }

  async function handleCapabilityRequest(message) {
    const { requestId, invocationId, method, args = [] } = message;
    try {
      const invocation = activeInvocationContexts.get(invocationId);
      if (!invocation) {
        const error = /** @type {Error & {code?: string}} */ (
          new Error('Browser capabilities are only available during an active tool invocation')
        );
        error.code = 'SKILL_CAPABILITY_DENIED';
        throw error;
      }
      if (method === 'connect') {
        const declared = [...new Set(skill.descriptor.capabilities?.browser || [])];
        if (!declared.some((capability) => invocation.capabilities.has(
          capability.startsWith('browser.') ? capability : `browser.${capability}`,
        ))) {
          invocation.capabilities.require('browser');
        }
        await runtime.getBrowser().connect();
        child?.send({ type: 'capability-result', requestId, result: null });
        return;
      }
      const capability = BROWSER_CAPABILITIES[method];
      if (!capability) throw new Error(`Unsupported browser capability method: ${method}`);
      invocation.capabilities.require(capability);
      const browser = runtime.getBrowser();
      if (typeof browser[method] !== 'function') throw new Error(`Browser method unavailable: ${method}`);
      const result = await browser[method](...args);
      child?.send({ type: 'capability-result', requestId, result });
    } catch (error) {
      child?.send({
        type: 'capability-error',
        requestId,
        error: { name: error.name, code: error.code, message: error.message, safeDetails: error.safeDetails },
      });
    }
  }

  function handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'log') {
      const level = ['info', 'warn', 'error'].includes(message.level) ? message.level : 'info';
      logger[level]?.(`[js-eyes][worker][${skill.id}]`, ...(message.args || []));
      return;
    }
    if (message.type === 'capability-request') {
      void handleCapabilityRequest(message);
      return;
    }
    const item = pending.get(message.requestId);
    if (!item) return;
    pending.delete(message.requestId);
    clearTimeout(item.timer);
    if (message.type.endsWith('-error') || message.error) item.reject(deserializeError(message.error));
    else item.resolve(message.result);
  }

  function rejectPending(error) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }

  async function activate() {
    if (state === 'active') return;
    if (state !== 'created') throw new Error(`Cannot activate worker from state ${state}`);
    state = 'starting';
    child = fork(path.join(__dirname, 'worker-entry.js'), [], {
      cwd: skill.skillDir,
      env: safeWorkerEnv(options.env),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
    });
    child.on('message', handleMessage);
    child.on('error', (error) => {
      state = 'failed';
      rejectPending(error);
    });
    child.on('exit', (code, signal) => {
      if (state !== 'disposed') state = 'failed';
      rejectPending(new Error(`Skill worker exited: code=${code}, signal=${signal || 'none'}`));
      child = null;
    });
    await sendRequest('activate', {
      entryPath: skill.entryPath,
      descriptor: skill.descriptor,
      config: runtime.config,
      storage: runtime.storage,
    }, options.startTimeoutMs || 10000);
    state = 'active';
  }

  async function invoke(toolName, context, input) {
    if (state !== 'active') throw new Error(`Skill worker is not active (${state})`);
    const signal = context?.signal;
    activeInvocationContexts.set(context.invocationId, context);
    try {
      const request = sendRequest('invoke', {
        toolName,
        context: {
          invocationId: context?.invocationId,
          toolCallId: context?.toolCallId,
          skillId: context?.skillId,
          source: context?.source,
          target: context?.target,
          risk: context?.risk,
          startedAt: context?.startedAt,
          deadline: context?.deadline,
        },
        input,
      }, context?.deadline ? Math.max(1, context.deadline - Date.now() + 1000) : undefined);
      if (signal) {
        const abort = () => child?.send({ type: 'cancel', invocationId: context.invocationId });
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        try { return await request; } finally { signal.removeEventListener('abort', abort); }
      }
      return await request;
    } finally {
      activeInvocationContexts.delete(context.invocationId);
    }
  }

  async function dispose() {
    if (state === 'disposed') return;
    const activeChild = child;
    state = 'disposing';
    if (activeChild?.connected) {
      try { await sendRequest('dispose', {}, options.disposeTimeoutMs || 5000); } catch {}
      try { activeChild.disconnect(); } catch {}
      const timer = setTimeout(() => {
        try { activeChild.kill(); } catch {}
      }, options.killTimeoutMs || 1000);
      timer.unref?.();
    }
    child = null;
    state = 'disposed';
    rejectPending(new Error('Skill worker disposed'));
  }

  return Object.freeze({
    activate,
    invoke,
    dispose,
    get state() { return state; },
    get pid() { return child?.pid || null; },
  });
}

module.exports = {
  BROWSER_CAPABILITIES,
  createSkillWorkerBackend,
  safeWorkerEnv,
};
