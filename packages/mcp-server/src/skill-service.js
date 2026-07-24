'use strict';

const { SkillHostService, flattenCapabilities } = require('@js-eyes/skill-runtime');
const pkg = require('../package.json');

class McpSkillService extends SkillHostService {
  constructor(config, session, options = {}) {
    super(config, {
      ...options,
      invocationSource: 'mcp',
      hostVersion: pkg.version,
      browserFactory: () => session.getBot(),
      disposeBrowser: false,
      allowedRisks: config.toolProfile === 'full'
        ? ['read', 'interactive', 'administrative', 'destructive']
        : ['read'],
    });
    this.session = session;
  }
}

module.exports = { McpSkillService, flattenCapabilities };
