export function createRegistrationContext({
  api,
  BrowserAutomation,
  getServerToken,
  requestTimeout,
  serverHost,
  serverPort,
  sharedServer,
}) {
  const state = {
    bot: null,
    server: null,
    skillRegistry: null,
    watchers: null,
    serverUsesSharedRef: false,
  };

  function ensureBot() {
    if (!state.bot) {
      state.bot = new BrowserAutomation(`ws://${serverHost}:${serverPort}`, {
        defaultTimeout: requestTimeout,
        token: getServerToken(),
        logger: {
          info: (message) => api.logger.info(message),
          warn: (message) => api.logger.warn(message),
          error: (message) => api.logger.error(message),
        },
      });
    }
    return state.bot;
  }

  function getActiveServer() {
    return state.server || sharedServer.instance;
  }

  async function teardownSidecars() {
    if (state.watchers) {
      try { await state.watchers.close(); } catch {}
      state.watchers = null;
    }
    if (state.skillRegistry) {
      try { await state.skillRegistry.disposeAll(); } catch {}
      state.skillRegistry = null;
    }
    if (state.bot) {
      try { state.bot.disconnect(); } catch {}
      state.bot = null;
    }
    state.server = null;
  }

  async function teardownRegistration(ctx) {
    const logger = (ctx && ctx.logger) || api.logger;
    await teardownSidecars();
    if (state.serverUsesSharedRef) {
      state.serverUsesSharedRef = false;
      await sharedServer.release();
    } else if (state.server) {
      try { await state.server.stop(); } catch {}
      state.server = null;
    }
    try { logger.info("[js-eyes] Service stopped"); } catch {}
  }

  return { ensureBot, getActiveServer, state, teardownRegistration, teardownSidecars };
}
