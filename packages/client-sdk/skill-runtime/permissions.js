'use strict';

const { SkillCapabilityError, SkillRiskError } = require('./errors');

const ALL_RISKS = Object.freeze([
  'read',
  'interactive',
  'administrative',
  'destructive',
]);

function normalizeSet(value, fallback = null) {
  if (value == null) return fallback;
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value);
  return new Set([value]);
}

function capabilityAllowed(capability, allowed) {
  if (allowed == null || allowed.has('*') || allowed.has(capability)) return true;
  for (const candidate of allowed) {
    if (candidate.endsWith('*') && capability.startsWith(candidate.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

function createSkillPermissionPolicy(options = {}) {
  const allowedRisks = normalizeSet(options.allowedRisks, new Set(ALL_RISKS));
  const allowedCapabilities = normalizeSet(options.allowedCapabilities, null);
  const authorize = typeof options.authorize === 'function'
    ? options.authorize
    : null;
  const source = options.source || 'host';

  return Object.freeze({
    allowedRisks,
    allowedCapabilities,
    async assert(invocation = {}) {
      const risk = invocation.risk || 'read';
      if (!allowedRisks.has(risk)) {
        throw new SkillRiskError(risk, invocation.source || source);
      }
      for (const capability of invocation.capabilities || []) {
        if (!capabilityAllowed(capability, allowedCapabilities)) {
          throw new SkillCapabilityError(capability, {
            source: invocation.source || source,
            skillId: invocation.skillId,
            toolName: invocation.toolName,
          });
        }
      }
      if (authorize) await authorize(invocation);
      return true;
    },
  });
}

module.exports = {
  ALL_RISKS,
  capabilityAllowed,
  createSkillPermissionPolicy,
};
