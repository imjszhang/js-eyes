'use strict';

const Ajv = require('ajv').default;

class SkillInputValidationError extends Error {
  constructor(toolName, errors = []) {
    super(`Invalid input for skill tool ${toolName}`);
    this.name = 'SkillInputValidationError';
    this.code = 'SKILL_INPUT_INVALID';
    this.safeDetails = { toolName, errors };
  }
}

const ajv = new Ajv({ allErrors: true, strict: false, ownProperties: true });

function compileToolInputValidator(tool) {
  const validate = ajv.compile(tool.inputSchema || tool.parameters || { type: 'object' });
  return (input) => {
    if (validate(input)) return input;
    throw new SkillInputValidationError(tool.name, (validate.errors || []).map((error) => ({
      instancePath: error.instancePath,
      keyword: error.keyword,
      message: error.message,
      params: error.params,
    })));
  };
}

module.exports = { SkillInputValidationError, compileToolInputValidator };
