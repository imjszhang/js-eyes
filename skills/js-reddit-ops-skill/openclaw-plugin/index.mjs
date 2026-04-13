import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = require('./openclaw.plugin.json');
const {
  registerOpenClawTools,
  resolveOpenClawPluginEntry,
} = require('@js-eyes/protocol/skills');
const skillContract = require('../skill.contract.js');

function register(api) {
  const adapter = skillContract.createOpenClawAdapter(api.pluginConfig ?? {}, api.logger);
  registerOpenClawTools(api, adapter);
}

const definition = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  register,
};

export default resolveOpenClawPluginEntry(definition);
