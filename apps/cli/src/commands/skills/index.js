'use strict';

const { ensureRuntimePaths, loadConfig, resolveSources } = require('../../command-context');
const { handleInstall, handleApprove } = require('./install');
const { handleLifecycle } = require('./lifecycle');
const { handleLink, handleReload, handleRelink, handleUnlink } = require('./links');
const { handleList } = require('./list');
const { handleUpdate } = require('./update');
const { handleVerify } = require('./verify');

async function commandSkills(positionals, flags) {
  const action = positionals[1];
  const skillId = positionals[2];
  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const sources = resolveSources(paths, config);
  const skillsDir = sources.primary;
  const context = { action, skillId, paths, config, sources, skillsDir, flags, positionals };

  switch (action) {
    case 'list': return handleList(context);
    case 'install': return handleInstall(context);
    case 'approve': return handleApprove(context);
    case 'update': return handleUpdate(context);
    case 'verify': return handleVerify(context);
    case 'enable':
    case 'disable': return handleLifecycle(context);
    case 'link': return handleLink(context);
    case 'unlink': return handleUnlink(context);
    case 'relink': return handleRelink(context);
    case 'reload': return handleReload(context);
    default:
      throw new Error('支持的命令: `js-eyes skills list` / `install <skillId> [--plan]` / `update <skillId|--all> [--dry-run]` / `approve <skillId>` / `verify [skillId]` / `enable <skillId>` / `disable <skillId>` / `link <path>` / `unlink <path>` / `relink <path>` / `reload`');
  }
}

module.exports = { commandSkills };
