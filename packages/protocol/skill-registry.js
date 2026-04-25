'use strict';

/**
 * SkillRegistry — js-eyes 技能运行时注册表
 *
 * 通过「工具级 dispatcher 间接层」实现零重启热加载：
 *   - 插件启动时 api.registerTool(name, dispatcher) 仅对每个 tool name 注册一次稳定闭包；
 *   - 每个 dispatcher 在调用时从 toolBindings.get(name) 查当前实现并委派；
 *   - 热加载只改 toolBindings 映射，不触碰宿主注册表。
 *
 * 对「全新 tool name 的首次出现」（init 之后）会尝试 api.registerTool；
 * 若宿主在运行时拒绝新工具名，降级为记录 warning，其余变更仍然 0 重启。
 *
 * Schema 透传：dispatcher 对象会携带 skill contract 的真实 `label`/`description`/`parameters`，
 * 让 OpenClaw / LLM 看到正确的入参约束（required / properties 等）。热加载时若 contract
 * 改了 schema，会按**引用** mutate 已注册的 dispatcher 对象；若某些 OpenClaw 宿主对 tool
 * 对象做了深拷贝/快照，则 mutate 不会生效，但首次注册的 schema 仍然是正确的。
 */

const fs = require('fs');
const path = require('path');

// Use a lazy module reference to avoid a circular require hazard: skills.js also
// re-exports factories from this module.
const skillsApi = require('./skills');
function buildAdapterTools(...args) { return skillsApi.buildAdapterTools(...args); }
function discoverSkillsFromSources(...args) { return skillsApi.discoverSkillsFromSources(...args); }
function getLegacyOpenClawSkillState(...args) { return skillsApi.getLegacyOpenClawSkillState(...args); }
function isSkillEnabled(...args) { return skillsApi.isSkillEnabled(...args); }
function loadSkillContract(...args) { return skillsApi.loadSkillContract(...args); }
function readSkillIntegrity(...args) { return skillsApi.readSkillIntegrity(...args); }
function resolveSkillSources(...args) { return skillsApi.resolveSkillSources(...args); }
function verifySkillIntegrity(...args) { return skillsApi.verifySkillIntegrity(...args); }

const { verifyExtraDir: verifyExtraSkillDir } = require('./extra-integrity');

const DEFAULT_UNAVAILABLE_MESSAGE = (name) =>
  `Tool "${name}" is not currently loaded (skill disabled, removed, or reloading).`;

function noopLogger() {
  const fn = () => {};
  return { info: fn, warn: fn, error: fn };
}

function makeLogger(candidate) {
  if (!candidate) return noopLogger();
  return {
    info: typeof candidate.info === 'function' ? candidate.info.bind(candidate) : () => {},
    warn: typeof candidate.warn === 'function' ? candidate.warn.bind(candidate) : () => {},
    error: typeof candidate.error === 'function' ? candidate.error.bind(candidate) : () => {},
  };
}

/**
 * 计算 skillDir 内"驱动热更"的关键文件的指纹（mtime 组合）。
 * 任一文件缺失按 0 处理；出错时退化为空字符串（此时 reload 语义保守：会认为"没变"）。
 * 只用 mtime 是因为 chokidar 已经有 awaitWriteFinish 保护；要更强隔离可改 sha1。
 */
function computeSkillFingerprint(skillDir) {
  if (!skillDir) return '';
  const targets = ['skill.contract.js', 'package.json'];
  const parts = [];
  for (const name of targets) {
    try {
      const st = fs.statSync(path.join(skillDir, name));
      parts.push(`${name}:${st.mtimeMs || 0}:${st.size || 0}`);
    } catch (_) {
      parts.push(`${name}:0:0`);
    }
  }
  return parts.join('|');
}

/**
 * 深度清理 require.cache：删除所有位于 skillDir 下（排除 node_modules）
 * 的已缓存模块，避免热加载时沿用旧模块实例。
 */
function purgeRequireCacheFor(skillDir) {
  if (!skillDir) return 0;
  let normalized;
  try {
    normalized = fs.realpathSync(skillDir);
  } catch (_) {
    normalized = path.resolve(skillDir);
  }
  const prefix = normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
  let purged = 0;
  for (const key of Object.keys(require.cache)) {
    if (!key) continue;
    if (key === normalized || key.startsWith(prefix)) {
      if (key.includes(`${path.sep}node_modules${path.sep}`)) continue;
      delete require.cache[key];
      purged++;
    }
  }
  return purged;
}

/**
 * 创建 SkillRegistry。
 *
 * options:
 *   - api: OpenClaw Plugin API（必需），需要 api.registerTool / api.logger
 *   - sources: 初始 sources（resolveSkillSources 的结果）。init/reload 时会重新解析。
 *   - pluginConfig: 传给 createOpenClawAdapter 的 plugin 配置
 *   - configLoader: () => hostConfig；默认从 @js-eyes/config 加载
 *   - setConfigValue: (key, value) => void；写入 host config（extras 默认 enable 用）
 *   - skillsDir: primary 目录（用于 resolveSkillSources 回退）
 *   - extrasProvider: () => string[]，每次 reload 重新取 extras 列表
 *   - wrapSensitiveTool: 复用插件的敏感工具包装器
 *   - logger: 日志通道
 *   - builtinToolNames: 禁止被技能覆盖的内置工具名集合
 *   - onConflict: 冲突回调
 */
function createSkillRegistry(options = {}) {
  const {
    api,
    pluginConfig = {},
    wrapSensitiveTool = null,
    builtinToolNames = [],
    // When true (default when a watcher is active), we set suppressNextReload
    // after our own setConfigValue writes so the chokidar echo doesn't cause a
    // duplicate reload. Leave this false in test harnesses that drive reload()
    // manually without a watcher.
    suppressSelfWrites = true,
  } = options;

  if (!api || typeof api.registerTool !== 'function') {
    throw new Error('createSkillRegistry: api.registerTool is required');
  }

  const logger = makeLogger(options.logger || api.logger);
  const configLoader = typeof options.configLoader === 'function'
    ? options.configLoader
    : () => ({});
  const setConfigValue = typeof options.setConfigValue === 'function'
    ? options.setConfigValue
    : () => {};
  const extrasProvider = typeof options.extrasProvider === 'function'
    ? options.extrasProvider
    : () => {
      const cfg = configLoader();
      return Array.isArray(cfg.extraSkillDirs) ? cfg.extraSkillDirs : [];
    };
  const skillsDir = options.skillsDir || '';

  // id -> { source, sourcePath, skillDir, contract, adapter, toolNames, enabled, dispose }
  const skills = new Map();
  // toolName -> { skillId, definition, optional }
  const toolBindings = new Map();
  // toolName -> dispatcher object (registered once per name; kept by reference so we can
  // mutate `description`/`parameters`/`label` on hot-reload to keep OpenClaw-visible schema in sync)
  const dispatchers = new Map();
  // Reserved names (built-ins + sensitive wrapper fixed names); skills cannot override.
  const reservedToolNames = new Set(builtinToolNames);

  let reloadInFlight = null;
  let suppressNextReload = false;
  let disposed = false;
  // Once-per-path dedup sets so hot reloads don't flood the log with the same
  // "Ignoring extra skill dir" / "Skipped extra skill" warnings on every tick.
  const warnedInvalidPaths = new Set();
  const warnedConflictKeys = new Set();

  function getState(skillId) {
    return skills.get(skillId) || null;
  }

  function deriveDispatcherMeta(toolName, definition) {
    const label = (definition && typeof definition.label === 'string' && definition.label)
      || toolName;
    const description = (definition && typeof definition.description === 'string' && definition.description)
      || `[js-eyes dispatcher] ${toolName}`;
    const parameters = (definition && definition.parameters && typeof definition.parameters === 'object')
      ? definition.parameters
      : { type: 'object', properties: {} };
    return { label, description, parameters };
  }

  function safeStringify(value) {
    try { return JSON.stringify(value); } catch (_) { return null; }
  }

  function ensureDispatcher(toolName, optional, definition) {
    const existing = dispatchers.get(toolName);
    const meta = deriveDispatcherMeta(toolName, definition);

    if (existing) {
      // Hot-reload path: the dispatcher was already registered with OpenClaw.
      // Mutate in place so hosts that keep the tool object by reference (e.g.
      // captured-registration's `tools.push(tool)`) surface the new schema; hosts that
      // snapshotted at registration time will keep the first-load schema, which is
      // already accurate for the common case.
      const changed =
        existing.label !== meta.label
        || existing.description !== meta.description
        || safeStringify(existing.parameters) !== safeStringify(meta.parameters);
      if (changed) {
        existing.label = meta.label;
        existing.description = meta.description;
        existing.parameters = meta.parameters;
        logger.info(
          `[js-eyes] Refreshed dispatcher schema for tool "${toolName}" (hot-reload; a one-time OpenClaw restart may be required if the host snapshots tool metadata)`,
        );
      }
      return { ok: true };
    }

    const dispatcher = {
      name: toolName,
      label: meta.label,
      description: meta.description,
      parameters: meta.parameters,
      async execute(toolCallId, params) {
        const binding = toolBindings.get(toolName);
        if (!binding) {
          return { content: [{ type: 'text', text: DEFAULT_UNAVAILABLE_MESSAGE(toolName) }] };
        }
        // Delegate via the current binding; execute is the authoritative behavior.
        // label/description/parameters on `dispatcher` are kept in sync via ensureDispatcher
        // on every applyBindings() so OpenClaw-visible metadata follows the latest contract.
        const def = binding.definition;
        return def.execute(toolCallId, params);
      },
    };
    try {
      api.registerTool(dispatcher, optional ? { optional: true } : undefined);
      dispatchers.set(toolName, dispatcher);
      return { ok: true };
    } catch (error) {
      logger.warn(
        `[js-eyes] Failed to register dispatcher for tool "${toolName}": ${error.message}. `
        + `A one-time OpenClaw restart may be required to expose this new tool.`,
      );
      return { ok: false, error };
    }
  }

  async function callDispose(state) {
    if (!state || typeof state.dispose !== 'function') return;
    try {
      await state.dispose();
    } catch (error) {
      logger.warn(
        `[js-eyes] dispose() for skill "${state.id}" threw: ${error.message}`,
      );
    }
  }

  function removeBindingsFor(skillId) {
    const removed = [];
    for (const [name, binding] of toolBindings) {
      if (binding.skillId === skillId) {
        toolBindings.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }

  async function disposeSkill(skillId) {
    const state = skills.get(skillId);
    if (!state) return false;
    removeBindingsFor(skillId);
    await callDispose(state);
    skills.delete(skillId);
    return true;
  }

  function loadSkillState(skill, effectiveConfig) {
    const sourceName = skill.id;
    const declaredTools = (() => {
      const installManifest = skill.source === 'primary'
        ? readSkillIntegrity(skill.skillDir)
        : null;
      return installManifest?.declaredTools || skill.tools || [];
    })();

    // Invariant: callers (_reloadCore) must `await disposeSkill(prev)` before we
    // purge the require cache below. Otherwise stale timers/listeners inside the
    // old contract module would outlive the purge and leak on every hot-reload.
    if (skills.has(skill.id)) {
      logger.warn(
        `[js-eyes] loadSkillState invoked for "${skill.id}" while an old state is still registered; caller must dispose it first to avoid leaks`,
      );
    }

    let contract;
    try {
      const purged = purgeRequireCacheFor(skill.skillDir);
      if (purged > 0) {
        logger.info(`[js-eyes] Purged ${purged} cached module(s) under "${skill.id}" skillDir before reload`);
      }
      contract = skill.contract || loadSkillContract(skill.skillDir);
    } catch (error) {
      logger.warn(`[js-eyes] Failed to load contract for "${skill.id}": ${error.message}`);
      return null;
    }
    if (!contract || typeof contract.createOpenClawAdapter !== 'function') {
      logger.warn(
        `[js-eyes] Skipping local skill "${skill.id}" because createOpenClawAdapter() is missing`,
      );
      return null;
    }

    let adapter;
    try {
      adapter = contract.createOpenClawAdapter(pluginConfig, api.logger);
    } catch (error) {
      logger.warn(`[js-eyes] createOpenClawAdapter threw for "${skill.id}": ${error.message}`);
      return null;
    }

    const { toolDefs, summary } = buildAdapterTools(adapter, {
      logger,
      sourceName,
      declaredTools,
      registeredNames: reservedToolNames,
      wrapTool: wrapSensitiveTool,
    });

    if (summary.skipped.length > 0) {
      for (const item of summary.skipped) {
        logger.warn(
          `[js-eyes] Skill "${skill.id}" skipped tool "${item.name}" (${item.reason})`,
        );
      }
    }

    const state = {
      id: skill.id,
      source: skill.source,
      sourcePath: skill.sourcePath,
      skillDir: skill.skillDir,
      fingerprint: computeSkillFingerprint(skill.skillDir),
      contract,
      adapter,
      toolNames: toolDefs.map((t) => t.toolName),
      // runtime.dispose is used by hot-unload to drain WS, clear intervals, etc.
      dispose: async () => {
        const runtime = adapter && adapter.runtime;
        if (runtime && typeof runtime.dispose === 'function') {
          await runtime.dispose();
        } else if (contract && contract.runtime && typeof contract.runtime.dispose === 'function') {
          // Allow module-level runtime.dispose override as a convenience.
          await contract.runtime.dispose();
        }
      },
      toolDefs,
    };
    void effectiveConfig;
    return state;
  }

  function applyBindings(state) {
    const failedDispatchers = [];
    for (const entry of state.toolDefs) {
      const dispatched = ensureDispatcher(entry.toolName, entry.optional, entry.definition);
      if (!dispatched.ok) {
        failedDispatchers.push(entry.toolName);
        continue;
      }
      toolBindings.set(entry.toolName, {
        skillId: state.id,
        definition: entry.definition,
        optional: entry.optional,
      });
    }
    return { failedDispatchers };
  }

  function runDiscover() {
    const cfg = configLoader();
    const extras = extrasProvider();
    const sources = resolveSkillSources({
      primary: skillsDir,
      extras,
    });

    const invalid = (sources && sources.invalid) || [];
    for (const item of invalid) {
      const key = `${item.path}|${item.reason}`;
      if (warnedInvalidPaths.has(key)) continue;
      warnedInvalidPaths.add(key);
      logger.warn(`[js-eyes] Ignoring extra skill dir "${item.path}" (${item.reason})`);
    }

    const { skills: discovered, conflicts } = discoverSkillsFromSources(sources, {
      onConflict: ({ id, winner, loser }) => {
        const key = `${id}|${loser.path}|${winner.path}`;
        if (warnedConflictKeys.has(key)) return;
        warnedConflictKeys.add(key);
        logger.warn(
          `[js-eyes] Skipped extra skill "${id}" at ${loser.path} (conflicts with ${winner.source} at ${winner.path})`,
        );
      },
    });

    return { sources, discovered, conflicts, config: cfg };
  }

  function ensureEnabledDefaults(discovered, hostConfig) {
    const legacyState = getLegacyOpenClawSkillState({
      skillIds: discovered.map((s) => s.id),
    });
    let mutated = 0;
    const enabledMap = (hostConfig && hostConfig.skillsEnabled) || {};
    for (const skill of discovered) {
      if (Object.prototype.hasOwnProperty.call(enabledMap, skill.id)) continue;
      if (skill.source === 'extra') {
        // Extras are trusted project directories; enable on first discovery.
        try {
          if (suppressSelfWrites) suppressNextReload = true;
          setConfigValue(`skillsEnabled.${skill.id}`, true);
          mutated++;
        } catch (error) {
          logger.warn(`[js-eyes] Failed to default-enable extra skill "${skill.id}": ${error.message}`);
        }
      } else {
        // Primary skills keep the "opt-in by default" security stance.
        const legacyValue = Object.prototype.hasOwnProperty.call(legacyState, skill.id)
          ? legacyState[skill.id]
          : false;
        try {
          if (suppressSelfWrites) suppressNextReload = true;
          setConfigValue(`skillsEnabled.${skill.id}`, legacyValue === true);
          mutated++;
          if (legacyValue !== true) {
            logger.warn(
              `[js-eyes] Skill "${skill.id}" left disabled by default; run \`js-eyes skills enable ${skill.id}\` to opt-in`,
            );
          }
        } catch (error) {
          logger.warn(`[js-eyes] Failed to seed skillsEnabled for "${skill.id}": ${error.message}`);
        }
      }
    }
    return { mutated, legacyState };
  }

  function checkIntegrity(skill, cfg = null) {
    if (skill.source === 'extra') {
      const effectiveCfg = cfg || configLoader();
      const verifyEnabled = Boolean(
        effectiveCfg
          && effectiveCfg.security
          && effectiveCfg.security.verifyExtraSkillDirs,
      );
      if (!verifyEnabled) return { ok: true, skipped: true };
      // `sourcePath` for extras is the root that was passed via `extraSkillDirs`
      // (either a skill dir or a parent dir). Verify that root — that matches
      // what `snapshotExtraDir(abs-path)` was asked to capture.
      const extraRoot = skill.sourcePath || skill.skillDir;
      const result = verifyExtraSkillDir(extraRoot);
      if (!result.hasSnapshot) {
        logger.warn(
          `[js-eyes] Refused extra skill "${skill.id}": no integrity snapshot for ${extraRoot}, run \`js-eyes skills relink ${extraRoot}\``,
        );
        return { ok: false };
      }
      if (!result.ok) {
        logger.warn(
          `[js-eyes] Refused extra skill "${skill.id}": integrity drift at ${extraRoot} (${result.drifted.length} changed, ${result.missing.length} missing, ${result.extra.length} new), run \`js-eyes skills relink ${extraRoot}\``,
        );
        return { ok: false };
      }
      return { ok: true };
    }
    if (skill.source !== 'primary') return { ok: true, skipped: true };
    const integrity = verifySkillIntegrity(skill.skillDir);
    if (integrity.hasIntegrity && !integrity.ok) {
      logger.warn(
        `[js-eyes] Refusing to load tampered skill "${skill.id}": ${integrity.mismatches.length} mismatched, ${integrity.missing.length} missing`,
      );
      return { ok: false };
    }
    if (!integrity.hasIntegrity) {
      logger.warn(
        `[js-eyes] Skill "${skill.id}" has no .integrity.json (legacy install); load allowed but consider reinstalling`,
      );
    }
    return { ok: true };
  }

  async function init() {
    if (disposed) throw new Error('SkillRegistry disposed');
    return _reloadCore({ isInit: true });
  }

  async function reload(reason = 'manual') {
    if (disposed) return { added: [], removed: [], reloaded: [], toggled: [], conflicts: [], reason: 'disposed' };
    if (suppressNextReload) {
      suppressNextReload = false;
      logger.info(`[js-eyes] reload suppressed (${reason}) — internal config write`);
      return { added: [], removed: [], reloaded: [], toggled: [], conflicts: [], reason: 'suppressed' };
    }
    if (reloadInFlight) return reloadInFlight;
    reloadInFlight = (async () => {
      try {
        return await _reloadCore({ isInit: false, reason });
      } finally {
        reloadInFlight = null;
      }
    })();
    return reloadInFlight;
  }

  async function _reloadCore({ isInit, reason }) {
    const { sources, discovered, conflicts } = runDiscover();
    const primary = sources && sources.primary ? sources.primary : '';
    const extras = sources && Array.isArray(sources.extras) ? sources.extras : [];

    if (isInit) {
      logger.info(
        `[js-eyes] Skill sources: primary=${primary || '(none)'} extras=${extras.length}`,
      );
    }

    const { legacyState } = ensureEnabledDefaults(discovered, configLoader());
    // Reload config after defaults seeding so isSkillEnabled sees fresh values.
    const effectiveConfig = configLoader();

    // Compute enabled map for diff.
    const nextById = new Map();
    for (const s of discovered) nextById.set(s.id, s);

    const prevIds = new Set(skills.keys());
    const nextIds = new Set(nextById.keys());

    const summary = {
      added: [],
      removed: [],
      reloaded: [],
      toggledOn: [],
      toggledOff: [],
      conflicts: conflicts || [],
      failedDispatchers: [],
      reason: reason || (isInit ? 'init' : 'reload'),
    };

    // Removed: present before, gone now.
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        await disposeSkill(id);
        summary.removed.push(id);
      }
    }

    for (const skill of discovered) {
      const enabled = isSkillEnabled(effectiveConfig, skill.id, legacyState);
      const existing = skills.get(skill.id);
      const integrity = checkIntegrity(skill, effectiveConfig);
      if (!integrity.ok) {
        if (existing) {
          await disposeSkill(skill.id);
          summary.removed.push(skill.id);
        }
        continue;
      }

      if (!enabled) {
        if (existing) {
          await disposeSkill(skill.id);
          summary.toggledOff.push(skill.id);
          logger.info(`[js-eyes] Skill "${skill.id}" toggled off`);
        } else if (isInit) {
          logger.info(`[js-eyes] Skipping disabled local skill "${skill.id}"`);
        }
        continue;
      }

      // Detect if reload is required: new, sourcePath changed, or the on-disk
      // contract/package.json fingerprint changed (true content hot-reload).
      const nextFingerprint = computeSkillFingerprint(skill.skillDir);
      const changed = !existing
        || existing.source !== skill.source
        || existing.sourcePath !== skill.sourcePath
        || existing.skillDir !== skill.skillDir
        || existing.fingerprint !== nextFingerprint;

      if (existing && !changed) {
        // Still alive; nothing to do unless explicit reload is requested.
        continue;
      }

      if (existing) {
        await disposeSkill(skill.id);
      }

      const state = loadSkillState(skill, effectiveConfig);
      if (!state) {
        continue;
      }
      const { failedDispatchers } = applyBindings(state);
      if (failedDispatchers.length > 0) {
        summary.failedDispatchers.push({ skillId: skill.id, toolNames: failedDispatchers });
      }
      skills.set(skill.id, state);

      if (!existing) {
        if (isInit) {
          logger.info(
            `[js-eyes] Loaded local skill "${skill.id}" with ${state.toolNames.length} tool(s)`,
          );
          summary.added.push(skill.id);
        } else {
          logger.info(
            `[js-eyes] Hot-loaded skill "${skill.id}" with ${state.toolNames.length} tool(s)`,
          );
          summary.added.push(skill.id);
        }
      } else {
        summary.reloaded.push(skill.id);
      }
    }

    // Toggled-on: skills that were previously disabled but are now enabled
    // (prev didn't have them, discovered does, and we loaded them). Already in added.
    // For clarity rename "added" when it was simply a toggle:
    // But callers primarily care about "what's now active", so we keep flat lists.

    if (isInit) {
      const active = skills.size;
      logger.info(
        `[js-eyes] Discovered ${discovered.length} skill(s): ${active} active`
        + (summary.conflicts.length > 0 ? `, ${summary.conflicts.length} conflict(s) resolved` : ''),
      );
    }

    return summary;
  }

  async function disposeAll() {
    disposed = true;
    const ids = Array.from(skills.keys());
    for (const id of ids) {
      await disposeSkill(id);
    }
  }

  function snapshot() {
    return {
      skills: Array.from(skills.values()).map((s) => ({
        id: s.id,
        source: s.source,
        sourcePath: s.sourcePath,
        skillDir: s.skillDir,
        tools: s.toolNames.slice(),
      })),
      toolBindings: Array.from(toolBindings.keys()),
      dispatchersRegistered: Array.from(dispatchers.keys()),
    };
  }

  return {
    init,
    reload,
    disposeSkill,
    disposeAll,
    snapshot,
    getState,
    // Testing / plugin integration helpers
    _internals: {
      toolBindings,
      skills,
      dispatchers,
      setSuppressNextReload(v) { suppressNextReload = Boolean(v); },
    },
  };
}

module.exports = {
  createSkillRegistry,
  purgeRequireCacheFor,
};
