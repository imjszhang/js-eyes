'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveHotReloadableSecurity,
  HOT_RELOADABLE_SECURITY_KEYS,
} = require('@js-eyes/config');
const {
  createState,
  _internal: { getOrCreatePolicyForClient },
} = require('@js-eyes/server-core/ws-handler');
const { createServer } = require('@js-eyes/server-core');
const { resolveSecurityConfig } = require('@js-eyes/protocol');

// ── resolveHotReloadableSecurity ─────────────────────────────────────

describe('resolveHotReloadableSecurity', () => {
  it('detects egressAllowlist addition as applied', () => {
    const prev = { egressAllowlist: ['a.example'], enforcement: 'soft' };
    const next = { egressAllowlist: ['a.example', 'b.example'], enforcement: 'soft' };
    const { applied, ignored, egressDiff } = resolveHotReloadableSecurity(next, prev);
    assert.deepEqual(applied, { egressAllowlist: ['a.example', 'b.example'] });
    assert.deepEqual(ignored, {});
    assert.deepEqual(egressDiff.added, ['b.example']);
    assert.deepEqual(egressDiff.removed, []);
  });

  it('detects egressAllowlist removal as applied', () => {
    const prev = { egressAllowlist: ['a.example', 'b.example'] };
    const next = { egressAllowlist: ['a.example'] };
    const { applied, egressDiff } = resolveHotReloadableSecurity(next, prev);
    assert.deepEqual(applied.egressAllowlist, ['a.example']);
    assert.deepEqual(egressDiff.removed, ['b.example']);
    assert.deepEqual(egressDiff.added, []);
  });

  it('returns empty applied/ignored when nothing changed', () => {
    const cfg = { egressAllowlist: ['a.example'], enforcement: 'soft' };
    const { applied, ignored } = resolveHotReloadableSecurity(cfg, cfg);
    assert.deepEqual(applied, {});
    assert.deepEqual(ignored, {});
  });

  it('records non-hot-safe changes under ignored, never applied', () => {
    const prev = { egressAllowlist: [], allowAnonymous: false, allowRemoteBind: false };
    const next = { egressAllowlist: [], allowAnonymous: true, allowRemoteBind: true };
    const { applied, ignored } = resolveHotReloadableSecurity(next, prev);
    assert.deepEqual(applied, {});
    assert.ok(ignored.allowAnonymous);
    assert.equal(ignored.allowAnonymous.before, false);
    assert.equal(ignored.allowAnonymous.after, true);
    assert.ok(ignored.allowRemoteBind);
  });

  it('mixes applied + ignored when both hot-safe and non-hot-safe change', () => {
    const prev = { egressAllowlist: [], allowAnonymous: false };
    const next = { egressAllowlist: ['x.example'], allowAnonymous: true };
    const { applied, ignored } = resolveHotReloadableSecurity(next, prev);
    assert.deepEqual(applied, { egressAllowlist: ['x.example'] });
    assert.ok(ignored.allowAnonymous);
  });

  it('HOT_RELOADABLE_SECURITY_KEYS includes egressAllowlist', () => {
    assert.ok(HOT_RELOADABLE_SECURITY_KEYS.includes('egressAllowlist'));
    // Fields that must remain restart-only:
    assert.ok(!HOT_RELOADABLE_SECURITY_KEYS.includes('allowAnonymous'));
    assert.ok(!HOT_RELOADABLE_SECURITY_KEYS.includes('allowRemoteBind'));
  });
});

// ── getOrCreatePolicyForClient generation check ──────────────────────

describe('getOrCreatePolicyForClient generation invalidation', () => {
  let state;
  let clientId;

  beforeEach(() => {
    state = createState();
    state.security = resolveSecurityConfig({
      security: { enforcement: 'soft', egressAllowlist: [] },
    });
    clientId = 'auto-test-1';
    state.automationClients.set(clientId, {
      socket: { readyState: 1, send() {}, close() {} },
      clientAddress: '127.0.0.1:0',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      anonymous: false,
    });
  });

  it('returns the same policy instance across calls at the same generation', () => {
    const p1 = getOrCreatePolicyForClient(state, clientId);
    const p2 = getOrCreatePolicyForClient(state, clientId);
    assert.ok(p1);
    assert.equal(p1, p2);
  });

  it('rebuilds policy when state.policyGeneration advances', () => {
    const p1 = getOrCreatePolicyForClient(state, clientId);
    assert.ok(p1);
    const conn = state.automationClients.get(clientId);
    assert.equal(conn.policyGeneration, state.policyGeneration);

    // Simulate reloadSecurity bumping the generation and swapping security.
    state.security = resolveSecurityConfig({
      security: { enforcement: 'soft', egressAllowlist: ['new.example'] },
    });
    state.policyGeneration += 1;

    const p2 = getOrCreatePolicyForClient(state, clientId);
    assert.notEqual(p1, p2);
    assert.equal(conn.policyGeneration, state.policyGeneration);
  });

  it('emits automation.policy-rebuilt audit event on rebuild', () => {
    const events = [];
    state.audit = { write: (event, payload) => events.push({ event, payload }) };
    getOrCreatePolicyForClient(state, clientId);
    state.policyGeneration += 1;
    getOrCreatePolicyForClient(state, clientId);
    const rebuilt = events.find((e) => e.event === 'automation.policy-rebuilt');
    assert.ok(rebuilt, 'expected automation.policy-rebuilt audit event');
    assert.equal(rebuilt.payload.clientId, clientId);
    assert.equal(rebuilt.payload.generation, state.policyGeneration);
  });

  it('returns null when enforcement=off, regardless of generation', () => {
    state.security = resolveSecurityConfig({ security: { enforcement: 'off' } });
    const p = getOrCreatePolicyForClient(state, clientId);
    assert.equal(p, null);
  });
});

// ── server.reloadSecurity() end-to-end ───────────────────────────────

function writeConfig(baseDir, security) {
  const configDir = path.join(baseDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ security }, null, 2),
    'utf8',
  );
}

describe('server.reloadSecurity (integration with temp HOME)', () => {
  let tmpDir;
  let server;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseyes-hotreload-'));
  });

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch {}
      server = null;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flips egressAllowlist at runtime, bumps policyGeneration, and reports applied keys', async () => {
    writeConfig(tmpDir, { enforcement: 'soft', egressAllowlist: [] });
    server = createServer({
      baseDir: tmpDir,
      hotReloadConfig: false,
      port: 0,
      host: '127.0.0.1',
      security: resolveSecurityConfig({
        security: { enforcement: 'soft', egressAllowlist: [] },
      }),
      logger: { info() {}, warn() {}, error() {} },
    });

    const gen0 = server.state.policyGeneration;
    assert.equal(gen0, 1);
    assert.deepEqual(server.state.security.egressAllowlist, []);

    // First reload: no on-disk change, nothing applied.
    const noop = server.reloadSecurity({ source: 'test-noop' });
    assert.equal(noop.changed, false);
    assert.equal(noop.generation, gen0);

    // Now rewrite config and reload.
    writeConfig(tmpDir, {
      enforcement: 'soft',
      egressAllowlist: ['a.example', 'b.example'],
    });

    const result = server.reloadSecurity({ source: 'test' });
    assert.equal(result.changed, true);
    assert.deepEqual(result.applied.egressAllowlist, ['a.example', 'b.example']);
    assert.deepEqual(result.ignored, {});
    assert.equal(result.generation, gen0 + 1);
    assert.equal(server.state.policyGeneration, gen0 + 1);
    assert.deepEqual(server.state.security.egressAllowlist, ['a.example', 'b.example']);
    assert.deepEqual(result.egressAllowlist, ['a.example', 'b.example']);
  });

  it('surfaces non-hot-safe changes under ignored and does not bump generation when only ignored differ', async () => {
    writeConfig(tmpDir, { enforcement: 'soft', allowAnonymous: false, egressAllowlist: [] });
    server = createServer({
      baseDir: tmpDir,
      hotReloadConfig: false,
      port: 0,
      host: '127.0.0.1',
      security: resolveSecurityConfig({
        security: { enforcement: 'soft', allowAnonymous: false, egressAllowlist: [] },
      }),
      logger: { info() {}, warn() {}, error() {} },
    });

    const gen0 = server.state.policyGeneration;

    // Flip a non-hot-safe field (allowAnonymous); egressAllowlist unchanged.
    writeConfig(tmpDir, { enforcement: 'soft', allowAnonymous: true, egressAllowlist: [] });

    const result = server.reloadSecurity({ source: 'test' });
    assert.equal(result.changed, false);
    assert.equal(result.generation, gen0, 'generation must not bump when only ignored fields change');
    assert.ok(result.ignored.allowAnonymous, 'allowAnonymous should appear under ignored');
    assert.equal(result.ignored.allowAnonymous.after, true);
    // Live state must still reflect the old allowAnonymous (restart required).
    assert.equal(server.state.security.allowAnonymous, false);
  });

  it('returns { changed: false, error } when config file is malformed', async () => {
    writeConfig(tmpDir, { enforcement: 'soft', egressAllowlist: [] });
    server = createServer({
      baseDir: tmpDir,
      hotReloadConfig: false,
      port: 0,
      host: '127.0.0.1',
      security: resolveSecurityConfig({ security: { enforcement: 'soft' } }),
      logger: { info() {}, warn() {}, error() {} },
    });

    const gen0 = server.state.policyGeneration;

    fs.writeFileSync(path.join(tmpDir, 'config', 'config.json'), '{not-json', 'utf8');

    const result = server.reloadSecurity({ source: 'test-bad' });
    assert.equal(result.changed, false);
    assert.ok(result.error, 'error field should be populated');
    assert.equal(server.state.policyGeneration, gen0, 'generation must not bump on malformed config');
  });
});
