'use strict';

let activated = null;
let descriptor = null;
/** @type {Readonly<Record<string, any>>} */
let runtimeConfig = Object.freeze({});
let storage = Object.freeze({});
const pendingCapabilities = new Map();
const invocationControllers = new Map();
let sequence = 0;

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code,
    message: error?.message || String(error),
    retryable: error?.retryable === true,
    safeDetails: error?.safeDetails || null,
    stack: error?.stack,
  };
}

function send(message) {
  if (process.connected) process.send(message);
}

function makeLogger(fields = {}) {
  const emit = (level) => (...args) => send({ type: 'log', level, fields, args });
  return Object.freeze({ info: emit('info'), warn: emit('warn'), error: emit('error') });
}

function browserProxy(invocationId) {
  return new Proxy({}, {
    get(_target, method) {
      if (typeof method !== 'string') return undefined;
      if (method === 'serverUrl') return runtimeConfig.serverUrl;
      if (method === 'logger') return makeLogger({ skillId: descriptor?.id });
      // The host owns the physical connection and closes it during runtime dispose.
      if (method === 'disconnect') return () => {};
      return (...args) => {
        sequence += 1;
        const requestId = `cap-${process.pid}-${sequence}`;
        return new Promise((resolve, reject) => {
          pendingCapabilities.set(requestId, { resolve, reject });
          send({ type: 'capability-request', requestId, invocationId, method, args });
        });
      };
    },
  });
}

function runtimeView(browser = browserProxy(null)) {
  return Object.freeze({
    config: runtimeConfig,
    storage,
    logger: makeLogger({ skillId: descriptor?.id }),
    browser,
    getBrowser: () => browser,
  });
}

async function handleActivate(message) {
  descriptor = Object.freeze(message.descriptor || {});
  runtimeConfig = Object.freeze(message.config || {});
  storage = Object.freeze(message.storage || {});
  delete require.cache[require.resolve(message.entryPath)];
  const entry = require(message.entryPath);
  activated = typeof entry.activate === 'function'
    ? await entry.activate({
        descriptor,
        runtime: runtimeView(),
        config: runtimeConfig,
        logger: makeLogger({ skillId: descriptor.id }),
      })
    : entry;
  if (!activated || typeof (activated.handlers || activated) !== 'object') {
    throw new Error('Skill worker entry did not provide handlers');
  }
}

async function handleInvoke(message) {
  const handlers = activated.handlers || activated;
  const handler = handlers[message.toolName];
  if (typeof handler !== 'function') throw new Error(`Missing worker handler: ${message.toolName}`);
  const controller = new AbortController();
  invocationControllers.set(message.context.invocationId, controller);
  const logger = makeLogger({
    skillId: descriptor.id,
    toolName: message.toolName,
    invocationId: message.context.invocationId,
  });
  const browser = browserProxy(message.context.invocationId);
  const context = Object.freeze({
    ...message.context,
    signal: controller.signal,
    config: runtimeConfig,
    storage,
    logger,
    browser,
    runtime: runtimeView(browser),
  });
  try {
    return await handler(context, message.input || {});
  } finally {
    invocationControllers.delete(message.context.invocationId);
  }
}

process.on('message', async (/** @type {any} */ message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'capability-result' || message.type === 'capability-error') {
    const item = pendingCapabilities.get(message.requestId);
    if (!item) return;
    pendingCapabilities.delete(message.requestId);
    if (message.type === 'capability-error') {
      const error = /** @type {Error & {code?: string}} */ (
        new Error(message.error?.message || 'Capability request failed')
      );
      error.code = message.error?.code;
      item.reject(error);
    } else item.resolve(message.result);
    return;
  }
  if (message.type === 'cancel') {
    invocationControllers.get(message.invocationId)?.abort(new Error('Invocation cancelled'));
    return;
  }
  try {
    let result = null;
    if (message.type === 'activate') await handleActivate(message);
    else if (message.type === 'invoke') result = await handleInvoke(message);
    else if (message.type === 'dispose') {
      if (activated && typeof activated.dispose === 'function') await activated.dispose();
      activated = null;
    } else return;
    send({ type: `${message.type}-result`, requestId: message.requestId, result });
  } catch (error) {
    send({ type: `${message.type}-error`, requestId: message.requestId, error: serializeError(error) });
  }
});

process.on('disconnect', () => process.exit(0));
