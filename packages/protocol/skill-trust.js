'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { computeSkillSourceDigest } = require('@js-eyes/skill-contract');

const TRUST_STORE_VERSION = 1;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}

function computeDescriptorDigest(descriptor) {
  const canonical = JSON.stringify(stableValue(descriptor || {}));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function resolveSourceRealpath(sourcePath) {
  try { return fs.realpathSync(sourcePath); } catch { return path.resolve(sourcePath || ''); }
}

function readStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { version: TRUST_STORE_VERSION, approvals: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      version: TRUST_STORE_VERSION,
      approvals: parsed && parsed.approvals && typeof parsed.approvals === 'object'
        ? parsed.approvals
        : {},
    };
  } catch {
    return { version: TRUST_STORE_VERSION, approvals: {} };
  }
}

function writeStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch {}
  }
}

function approvalKey(skill) {
  return `${skill.id}\u0000${resolveSourceRealpath(skill.skillDir || skill.sourcePath)}`;
}

function createSkillTrustStore(options = {}) {
  if (!options.filePath) throw new TypeError('createSkillTrustStore requires filePath');
  const filePath = path.resolve(options.filePath);

  function inspect(skill) {
    const store = readStore(filePath);
    const key = approvalKey(skill);
    const approval = store.approvals[key] || null;
    const descriptorDigest = computeDescriptorDigest(skill.descriptor);
    const sourceRealpath = resolveSourceRealpath(skill.skillDir || skill.sourcePath);
    const sourceDigest = computeSkillSourceDigest(sourceRealpath);
    if (!approval) return { approved: false, reason: 'missing', descriptorDigest, sourceDigest, sourceRealpath };
    if (approval.descriptorDigest !== descriptorDigest) {
      return { approved: false, reason: 'descriptor-changed', approval, descriptorDigest, sourceDigest, sourceRealpath };
    }
    if (approval.sourceRealpath !== sourceRealpath) {
      return { approved: false, reason: 'source-changed', approval, descriptorDigest, sourceDigest, sourceRealpath };
    }
    if (approval.sourceDigest !== sourceDigest) {
      return { approved: false, reason: 'source-content-changed', approval, descriptorDigest, sourceDigest, sourceRealpath };
    }
    if (!['worker', 'in-process'].includes(approval.executionMode)) {
      return { approved: false, reason: 'execution-mode-invalid', approval, descriptorDigest, sourceDigest, sourceRealpath };
    }
    return { approved: true, reason: 'approved', approval, descriptorDigest, sourceDigest, sourceRealpath };
  }

  function approve(skill, approvalOptions = {}) {
    const store = readStore(filePath);
    const key = approvalKey(skill);
    const sourceRealpath = resolveSourceRealpath(skill.skillDir || skill.sourcePath);
    const record = {
      skillId: skill.id,
      publisher: skill.descriptor?.publisher || '',
      sourceRealpath,
      descriptorDigest: computeDescriptorDigest(skill.descriptor),
      sourceDigest: computeSkillSourceDigest(sourceRealpath),
      executionMode: approvalOptions.executionMode || 'worker',
      capabilities: skill.descriptor?.capabilities || {},
      approvedAt: new Date().toISOString(),
    };
    store.approvals[key] = record;
    writeStore(filePath, store);
    return record;
  }

  function revoke(skill) {
    const store = readStore(filePath);
    const removed = delete store.approvals[approvalKey(skill)];
    if (removed) writeStore(filePath, store);
    return removed;
  }

  return Object.freeze({
    filePath,
    approve,
    inspect,
    isApproved: (skill) => inspect(skill).approved,
    list: () => Object.values(readStore(filePath).approvals),
    revoke,
  });
}

module.exports = {
  TRUST_STORE_VERSION,
  computeDescriptorDigest,
  createSkillTrustStore,
};
