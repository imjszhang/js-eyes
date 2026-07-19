import { createRequire } from "node:module";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { hashFileSha1Sync } from "./fs-utils/hash.mjs";

const require = createRequire(import.meta.url);

const WATCHER_IGNORED = [
  /(^|[/\\])\.DS_Store$/,
  /(^|[/\\])\.git([/\\]|$)/,
  /\.sw[pox]$/i,
  /~$/,
];

function tryLoadChokidar() {
  try {
    return require("chokidar");
  } catch {
    return null;
  }
}

export function createHotReloadWatchers({
  api,
  fullRuntime,
  pluginConfig,
  runtimePaths,
  skillRegistry,
  skillSources,
}) {
  let configWatcher = null;
  let skillDirWatcher = null;
  let reloadTimer = null;
  const lastHashByPath = new Map();

  function scheduleReload(reason) {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      skillRegistry.reload(reason).catch((error) => {
        api.logger.warn(`[js-eyes] Hot reload failed: ${error.message}`);
      });
    }, 300);
  }

  function scheduleReloadIfChanged(reason, filePath) {
    if (!filePath) {
      scheduleReload(reason);
      return;
    }
    const previous = lastHashByPath.get(filePath);
    const next = hashFileSha1Sync(filePath);
    if (previous === next && previous !== undefined) {
      return;
    }
    lastHashByPath.set(filePath, next);
    scheduleReload(reason);
  }

  const watchConfig = pluginConfig.watchConfig !== false;
  const devWatchSkills = pluginConfig.devWatchSkills !== false;
  const chokidar = watchConfig || devWatchSkills ? tryLoadChokidar() : null;

  if (fullRuntime && watchConfig && chokidar) {
    try {
      configWatcher = chokidar.watch(runtimePaths.configFile, {
        persistent: true,
        ignoreInitial: true,
        ignored: WATCHER_IGNORED,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      });
      configWatcher.on('all', (_event, filePath) =>
        scheduleReloadIfChanged('config-watch', filePath || runtimePaths.configFile));
      configWatcher.on('error', (error) => {
        api.logger.warn(`[js-eyes] config watcher error: ${error.message}`);
      });
      api.logger.info(`[js-eyes] Watching host config: ${runtimePaths.configFile}`);
    } catch (error) {
      api.logger.warn(`[js-eyes] Failed to start config watcher: ${error.message}`);
    }
  } else if (fullRuntime && watchConfig && !chokidar) {
    api.logger.warn('[js-eyes] chokidar not installed; host-config hot reload disabled. Install chokidar to enable.');
  }

  if (fullRuntime && devWatchSkills && chokidar) {
    try {
      const watchGlobs = [];
      if (skillSources?.primary && nodeFs.existsSync(skillSources.primary)) {
        watchGlobs.push(nodePath.join(skillSources.primary, '*', 'skill.contract.js'));
        watchGlobs.push(nodePath.join(skillSources.primary, '*', 'package.json'));
      }
      for (const extra of skillSources?.extras || []) {
        if (extra.kind === 'skill') {
          watchGlobs.push(nodePath.join(extra.path, 'skill.contract.js'));
          watchGlobs.push(nodePath.join(extra.path, 'package.json'));
        } else {
          watchGlobs.push(nodePath.join(extra.path, '*', 'skill.contract.js'));
          watchGlobs.push(nodePath.join(extra.path, '*', 'package.json'));
        }
      }
      if (watchGlobs.length > 0) {
        skillDirWatcher = chokidar.watch(watchGlobs, {
          persistent: true,
          ignoreInitial: true,
          ignored: WATCHER_IGNORED,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 80 },
        });
        skillDirWatcher.on('all', (_event, filePath) =>
          scheduleReloadIfChanged('skill-dir-watch', filePath));
        skillDirWatcher.on('error', (error) => {
          api.logger.warn(`[js-eyes] skill dir watcher error: ${error.message}`);
        });
        api.logger.info(`[js-eyes] Watching ${watchGlobs.length} skill path(s) for hot reload`);
      }
    } catch (error) {
      api.logger.warn(`[js-eyes] Failed to start skill-dir watcher: ${error.message}`);
    }
  }

  return {
    async close() {
      if (reloadTimer) {
        try { clearTimeout(reloadTimer); } catch {}
        reloadTimer = null;
      }
      if (configWatcher) {
        try { await configWatcher.close(); } catch {}
        configWatcher = null;
      }
      if (skillDirWatcher) {
        try { await skillDirWatcher.close(); } catch {}
        skillDirWatcher = null;
      }
    },
  };
}
