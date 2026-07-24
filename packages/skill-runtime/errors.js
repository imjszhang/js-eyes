'use strict';

class SkillRuntimeError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = options.code || 'SKILL_RUNTIME_ERROR';
    this.retryable = options.retryable === true;
    this.safeDetails = options.safeDetails || null;
  }
}

class SkillCapabilityError extends SkillRuntimeError {
  constructor(capability) {
    super(`Skill capability is not granted: ${capability}`, {
      code: 'SKILL_CAPABILITY_DENIED',
      safeDetails: { capability },
    });
    this.capability = capability;
  }
}

class SkillTimeoutError extends SkillRuntimeError {
  constructor(message = 'Skill invocation timed out', details = {}) {
    super(message, { code: 'SKILL_TIMEOUT', retryable: true, safeDetails: details });
  }
}

class SkillCancelledError extends SkillRuntimeError {
  constructor(message = 'Skill invocation was cancelled') {
    super(message, { code: 'SKILL_CANCELLED', retryable: true });
  }
}

class SkillDisposedError extends SkillRuntimeError {
  constructor() {
    super('Skill runtime has been disposed', { code: 'SKILL_DISPOSED' });
  }
}

class SkillRiskError extends SkillRuntimeError {
  constructor(risk, source) {
    super(`Skill risk is not allowed by this host profile: ${risk}`, {
      code: 'SKILL_RISK_DENIED',
      safeDetails: { risk, source },
    });
  }
}

module.exports = {
  SkillCancelledError,
  SkillCapabilityError,
  SkillDisposedError,
  SkillRuntimeError,
  SkillRiskError,
  SkillTimeoutError,
};
