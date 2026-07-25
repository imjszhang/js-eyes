'use strict';

const { SkillHostService, flattenCapabilities } = require('@js-eyes/skill-runtime');
const pkg = require('../package.json');

const SAFE_SKILL_CAPABILITIES = Object.freeze([
  'browser.tabs.read',
  'browser.page.read',
  'browser.navigation',
  'browser.screenshot',
  'filesystem.skillData',
  'network.direct',
  'network.host:*',
]);

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
      allowedCapabilities: config.toolProfile === 'full'
        ? undefined
        : SAFE_SKILL_CAPABILITIES,
    });
    this.session = session;
  }
}

module.exports = {
  McpSkillService,
  SAFE_SKILL_CAPABILITIES,
  flattenCapabilities,
};
