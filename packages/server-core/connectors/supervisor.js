'use strict';

const { createCdpConnector } = require('./cdp');
const { createBidiConnector } = require('./bidi');

async function startConnectors(state, options = {}) {
  const browserConfig = options.browserConfig || state.browserConfig || {};
  const security = options.security || state.security || {};
  const audit = options.audit || state.audit || null;
  const logger = options.logger || console;
  const transports = browserConfig.transports || {};
  const running = [];

  if (transports.cdp && transports.cdp.enabled) {
    const connector = createCdpConnector({
      config: transports.cdp,
      security,
      state,
      audit,
      logger,
    });
    try {
      await connector.start();
      running.push(connector);
    } catch (error) {
      logger.warn?.(`[js-eyes-server] CDP connector not connected: ${error.message}`);
      audit?.write?.('browser.connector.connect-failed', {
        kind: 'cdp',
        error: error.message,
      });
    }
  }

  if (transports.bidi && transports.bidi.enabled) {
    const connector = createBidiConnector({
      config: transports.bidi,
      security,
      state,
      audit,
      logger,
    });
    try {
      await connector.start();
      running.push(connector);
    } catch (error) {
      logger.warn?.(`[js-eyes-server] BiDi connector not connected: ${error.message}`);
      audit?.write?.('browser.connector.connect-failed', {
        kind: 'bidi',
        error: error.message,
      });
    }
  }

  return {
    connectors: running,
    async stop() {
      for (const connector of running) {
        try { await connector.stop(); } catch { /* ignore */ }
      }
    },
  };
}

module.exports = { startConnectors };
