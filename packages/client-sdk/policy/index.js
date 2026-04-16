'use strict';

const { TaskOriginTracker } = require('./task-origin');
const { TaintRegistry } = require('./taint');
const { EgressGate } = require('./egress');
const { parseOriginFromUrl, normalizeHost } = require('./origin-utils');

const DEFAULT_ENFORCEMENT = 'soft';

const TAB_SINK_TOOLS = new Set([
  'executeScript', 'injectCss', 'uploadFileToTab', 'getCookies',
]);

class PolicyContext {
  constructor(options = {}) {
    const security = options.security || {};
    this.enforcement = security.enforcement || DEFAULT_ENFORCEMENT;
    this.sessionId = options.sessionId || null;
    this.logger = options.logger || null;
    this.audit = options.audit || null;
    this.dryRun = Boolean(options.dryRun);

    const taskOriginCfg = security.taskOrigin || { enabled: true, sources: ['user-message', 'skill-platforms', 'active-tab', 'fetched-links'] };
    this.taskOriginEnabled = taskOriginCfg.enabled !== false;
    this.taskOrigin = new TaskOriginTracker({ sources: taskOriginCfg.sources });

    const taintCfg = security.taint || { enabled: true, mode: 'canary+substring', minValueLength: 6 };
    this.taintEnabled = taintCfg.enabled !== false;
    this.taint = new TaintRegistry({
      mode: taintCfg.mode || 'canary+substring',
      minValueLength: taintCfg.minValueLength || 6,
    });

    this.egress = new EgressGate({
      allowlist: Array.isArray(security.egressAllowlist) ? security.egressAllowlist : [],
      taskOrigin: this.taskOrigin,
      pendingDir: options.pendingEgressDir || null,
      logger: this.logger,
    });

    this._tabCache = new Map();
    this._tabCacheAt = 0;
    this._tabLookup = typeof options.tabLookup === 'function' ? options.tabLookup : null;

    if (Array.isArray(options.userMessages)) this.taskOrigin.addUserMessages(options.userMessages);
    if (Array.isArray(options.platforms)) this.taskOrigin.addPlatforms(options.platforms);
    if (options.activeTabUrl) this.taskOrigin.addActiveTabUrl(options.activeTabUrl);
  }

  setTabLookup(fn) {
    if (typeof fn === 'function') this._tabLookup = fn;
  }

  recordUserMessages(messages) {
    this.taskOrigin.addUserMessages(messages);
  }

  recordPlatforms(platforms) {
    this.taskOrigin.addPlatforms(platforms);
  }

  recordActiveTab(url) {
    this.taskOrigin.addActiveTabUrl(url);
  }

  recordFetchedHtml(html) {
    this.taskOrigin.addFetchedLinks(html);
  }

  recordTabs(tabs, activeTabId = null) {
    if (!Array.isArray(tabs)) return;
    const now = Date.now();
    for (const tab of tabs) {
      if (!tab || typeof tab !== 'object') continue;
      const tabId = tab.id ?? tab.tabId;
      const url = tab.url || tab.pendingUrl || '';
      if (tabId != null && url) {
        this._tabCache.set(Number(tabId), { url, at: now });
        if (activeTabId != null && Number(activeTabId) === Number(tabId)) {
          this.taskOrigin.addActiveTabUrl(url);
        }
      }
    }
    this._tabCacheAt = now;
  }

  async resolveTabOrigin(tabId) {
    if (tabId == null) return null;
    const id = Number(tabId);
    const cached = this._tabCache.get(id);
    if (cached && cached.url) {
      return parseOriginFromUrl(cached.url);
    }
    if (this._tabLookup) {
      try {
        const url = await this._tabLookup(id);
        if (url) {
          this._tabCache.set(id, { url, at: Date.now() });
          return parseOriginFromUrl(url);
        }
      } catch {}
    }
    return null;
  }

  tagCookiesReturn(cookies, meta = {}) {
    if (!this.taintEnabled) return cookies;
    return this.taint.tagCookies(cookies, meta);
  }

  _emitAudit(event, payload) {
    try {
      if (this.audit && typeof this.audit.write === 'function') {
        this.audit.write(event, payload);
      } else if (this.logger && typeof this.logger.info === 'function') {
        this.logger.info(`[js-eyes][policy] ${event} ${JSON.stringify(payload)}`);
      }
    } catch {}
  }

  _applyEnforcement(decision, payload) {
    if (this.enforcement === 'off') {
      this._emitAudit('policy.audit-only', { ...payload, originalDecision: decision });
      return { decision: 'allow', softened: true, originalDecision: decision };
    }
    if (this.enforcement === 'soft') {
      this._emitAudit('policy.soft-block', payload);
      return { decision: decision === 'deny' ? 'soft-block' : decision, softened: false };
    }
    this._emitAudit('policy.block', payload);
    return { decision, softened: false };
  }

  async evaluate(toolName, params = {}) {
    const reasons = [];
    let transformedParams = params;
    const meta = { tool: toolName };

    if (this.taintEnabled && params && typeof params === 'object') {
      const scan = this.taint.scan(params);
      if (scan.hit) {
        reasons.push({ rule: 'L4b-taint', reason: scan.reason, canary: scan.canary, meta: scan.meta });
        const payload = {
          tool: toolName,
          rule_decision: 'soft-block',
          taint_hit: true,
          reasons,
          enforcement: this.enforcement,
        };
        const applied = this._applyEnforcement('deny', payload);
        return { decision: applied.decision, reasons, transformedParams, rule: 'L4b-taint' };
      }
    }

    if (this.taskOriginEnabled && TAB_SINK_TOOLS.has(toolName)) {
      const tabId = params && (params.tabId ?? params.tab_id);
      if (tabId != null) {
        const origin = await this.resolveTabOrigin(tabId);
        if (origin) {
          if (!this.taskOrigin.isInScope(origin)) {
            reasons.push({ rule: 'L4a-task-origin', host: origin });
            const payload = {
              tool: toolName, rule_decision: 'soft-block', task_origin: origin,
              reasons, enforcement: this.enforcement,
            };
            const applied = this._applyEnforcement('deny', payload);
            return { decision: applied.decision, reasons, transformedParams, rule: 'L4a-task-origin' };
          }
        }
      }
    }

    if (this.taskOriginEnabled && toolName === 'getCookiesByDomain') {
      const domain = params && params.domain;
      if (domain) {
        if (!this.taskOrigin.isInScope(domain)) {
          reasons.push({ rule: 'L4a-task-origin', host: domain });
          const payload = {
            tool: toolName, rule_decision: 'soft-block', task_origin: domain,
            reasons, enforcement: this.enforcement,
          };
          const applied = this._applyEnforcement('deny', payload);
          return { decision: applied.decision, reasons, transformedParams, rule: 'L4a-task-origin' };
        }
      }
    }

    if (toolName === 'openUrl') {
      const url = params && params.url;
      const egressResult = this.egress.evaluateUrl(url);
      if (egressResult.decision === 'pending-egress') {
        const pending = this.egress.writePending({
          tool: toolName,
          params: { url },
          reason: egressResult.reason,
          host: egressResult.host,
          enforcement: this.enforcement,
        });
        reasons.push({ rule: 'L5-egress', host: egressResult.host, pendingId: pending?.id || null });
        const payload = {
          tool: toolName,
          rule_decision: 'pending-egress',
          egress_matched: false,
          task_origin: egressResult.host,
          reasons,
          pendingId: pending?.id || null,
          enforcement: this.enforcement,
        };
        if (this.enforcement === 'off') {
          this._emitAudit('policy.audit-only', { ...payload, originalDecision: 'pending-egress' });
          return { decision: 'allow', reasons, transformedParams, rule: 'L5-egress', pendingId: pending?.id || null, softened: true };
        }
        this._emitAudit('policy.pending-egress', payload);
        return { decision: 'pending-egress', reasons, transformedParams, rule: 'L5-egress', pendingId: pending?.id || null };
      }
      if (egressResult.decision === 'allow') {
        this._emitAudit('policy.allow', {
          tool: toolName,
          rule_decision: 'allow',
          egress_matched: true,
          task_origin: egressResult.host,
          enforcement: this.enforcement,
        });
      }
    }

    return { decision: 'allow', reasons, transformedParams };
  }

  listPendingEgress() {
    return this.egress.listPending();
  }

  approvePending(id) {
    const pending = this.egress.listPending().find((e) => e.id === id);
    if (!pending) return null;
    if (pending.host) this.egress.allowSession(pending.host);
    this.egress.removePending(id);
    return pending;
  }

  allowDomain(domain) {
    this.egress.addStatic(domain);
    return normalizeHost(domain);
  }
}

module.exports = {
  PolicyContext,
  TaskOriginTracker,
  TaintRegistry,
  EgressGate,
};
