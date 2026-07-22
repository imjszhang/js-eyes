'use strict';

const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { FacadeError, normalizeError } = require('./error-adapter');

class BrowserSession {
  constructor(config, options = {}) {
    this.config = config;
    this.logger = options.logger || console;
    this.automationFactory = options.automationFactory
      || ((serverUrl, botOptions) => new BrowserAutomation(serverUrl, botOptions));
    this.bot = null;
  }

  getBot() {
    if (!this.bot) {
      const botOptions = {
        logger: this.logger,
        defaultTimeout: this.config.requestTimeout,
        connectTimeout: this.config.connectTimeout,
      };
      if (Object.prototype.hasOwnProperty.call(this.config, 'token')) {
        botOptions.token = this.config.token;
      }
      this.bot = this.automationFactory(this.config.serverUrl, botOptions);
    }
    return this.bot;
  }

  async ensureConnected() {
    try {
      await this.getBot().ensureConnected();
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async listClients() {
    await this.ensureConnected();
    return this.getBot().listClients({ timeout: this.config.connectTimeout });
  }

  async resolveTarget(explicitTarget) {
    const requested = explicitTarget || this.config.target;
    const clients = await this.listClients();
    if (clients.length === 0) {
      throw new FacadeError(
        'JS_EYES_EXTENSION_UNAVAILABLE',
        'No JS Eyes browser extension is connected.',
      );
    }
    if (requested) {
      const exact = clients.find((client) => client.clientId === requested);
      if (exact) return exact.clientId;
      const requestedName = String(requested).toLowerCase();
      const named = clients.filter(
        (client) => String(client.browserName || '').toLowerCase() === requestedName,
      );
      if (named.length === 1) return named[0].clientId;
      if (named.length > 1) {
        throw new FacadeError(
          'JS_EYES_TARGET_REQUIRED',
          `Browser target "${requested}" matches multiple connected extensions; use a clientId.`,
          { candidates: named.map((client) => client.clientId) },
        );
      }
      throw new FacadeError(
        'JS_EYES_EXTENSION_UNAVAILABLE',
        `Browser target "${requested}" is not connected.`,
      );
    }
    if (clients.length === 1) return clients[0].clientId;
    throw new FacadeError(
      'JS_EYES_TARGET_REQUIRED',
      'Multiple browser extensions are connected; specify target using a clientId or unique browser name.',
      { candidates: clients.map((client) => ({ clientId: client.clientId, browserName: client.browserName })) },
    );
  }

  async operationOptions(target, extra = {}) {
    return {
      ...extra,
      timeout: extra.timeout || this.config.requestTimeout,
      target: await this.resolveTarget(target),
    };
  }

  async status() {
    try {
      const clients = await this.listClients();
      const ready = clients.length > 0;
      return {
        healthy: ready,
        serverReachable: true,
        serverUrl: this.config.serverUrl,
        toolProfile: this.config.toolProfile,
        defaultTarget: this.config.target,
        clients,
        ...(!ready ? {
          error: {
            code: 'JS_EYES_EXTENSION_UNAVAILABLE',
            message: 'The JS Eyes server is running, but no browser extension is connected.',
          },
        } : {}),
      };
    } catch (error) {
      const normalized = normalizeError(error);
      return {
        healthy: false,
        serverReachable: false,
        serverUrl: this.config.serverUrl,
        toolProfile: this.config.toolProfile,
        defaultTarget: this.config.target,
        clients: [],
        error: { code: normalized.code, message: normalized.message },
      };
    }
  }

  async disconnect() {
    if (!this.bot) return;
    const bot = this.bot;
    this.bot = null;
    try {
      bot.disconnect();
    } catch (error) {
      this.logger.warn(`disconnect failed: ${error.message}`);
    }
  }
}

module.exports = { BrowserSession };
