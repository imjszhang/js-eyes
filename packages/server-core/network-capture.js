'use strict';

const { createHash } = require('node:crypto');
const { pickUniqueBrowserClient } = require('./connectors/registry');
const fault = (code) => Object.assign(new Error(code), {code});

// Grants are bound to the actual extension connection and policy generation.
// The random owner token also allows an authenticated worker to reconnect.
async function handleCaptureRequest(data, clientId, socket, state, request) {
  const action = data.action || data.type;
  try {
    const conn = state.automationClients.get(clientId);
    if (!conn || conn.anonymous) throw fault('AUTH_REQUIRED');
    if (!Number.isSafeInteger(data.tabId) || data.tabId < 0 || !/^[a-zA-Z0-9_-]{32,128}$/.test(data.ownerToken || '')) throw fault('INVALID_ARGUMENT');
    const owner = createHash('sha256').update(data.ownerToken).digest('hex');
    const picked = pickUniqueBrowserClient(state, data.target);
    if (!picked.client) throw fault(picked.error);
    const browser = picked.client;
    if (browser.anonymous || browser.kind !== 'extension' || browser.browserName !== 'firefox' || !browser.capabilities.includes('browser.network.capture')) throw fault('CAPABILITY_UNSUPPORTED');
    const grants = state.captureGrants || (state.captureGrants = new Map());
    const generation = state.policyGeneration || 1;
    for (const [key, grant] of grants) {
      if (grant.generation !== generation || Date.now() - grant.at > 600000 || !grant.browser.isOpen()) grants.delete(key);
    }
    const key = `${browser.clientId}:${data.tabId}:${owner}`;
    const grant = grants.get(key);
    let options;
    if (action === 'capture_start') {
      const tab = browser.tabs.find(t => Number(t.id ?? t.tabId) === data.tabId);
      if (!tab || typeof tab.incognito !== 'boolean') throw fault('PRIVACY_CAPABILITY_UNAVAILABLE');
      if (tab.incognito || tab.private) throw fault('PRIVATE_TAB_UNSUPPORTED');
      options = data.options;
      if (!options || !Array.isArray(options.origins) || !options.origins.includes(new URL(tab.url).origin)) throw fault('CAPTURE_SCOPE_INVALID');
      if (grants.size >= 64 && !grant) throw fault('CAPTURE_LIMIT');
      // Use the selected browser's tab (IDs can collide across connectors).
      const { PolicyContext } = require('@js-eyes/policy');
      const policy = new PolicyContext({security:state.security || {}, tabLookup:() => tab.url});
      policy.recordTabs(browser.tabs, browser.activeTabId);
      if (state.security?.enforcement !== 'off') {
        const decision = await policy.evaluate('startCapture', {tabId:data.tabId});
        if (['deny','soft-block','pending-egress'].includes(decision.decision)) throw fault('POLICY_SOFT_BLOCK');
      }
    } else if (!grant || grant.browser !== browser || grant.generation !== generation || grant.sessionId !== data.sessionId) {
      throw fault('CAPTURE_NOT_FOUND');
    }
    const result = await request(browser, action, {
      tabId:data.tabId, owner, options, sessionId:data.sessionId,
      afterSeq:data.afterSeq, throughSeq:data.throughSeq, limit:data.limit, maxBytes:data.maxBytes,
    });
    if (action === 'capture_start') {
      if (typeof result.result?.sessionId !== 'string') throw fault('CAPTURE_PROTOCOL_INVALID');
      grants.set(key, {browser, generation, sessionId:result.result.sessionId, at:Date.now()});
    } else grant.at = Date.now();
    socket.send(JSON.stringify({type:`${action}_response`, requestId:data.requestId, status:'success', result:result.result}));
  } catch (error) {
    socket.send(JSON.stringify({type:`${action}_response`, requestId:data.requestId, status:'error', code:error.code || 'CAPTURE_FAILED', message:error.code || 'Capture request failed'}));
  }
}
module.exports = { handleCaptureRequest };
