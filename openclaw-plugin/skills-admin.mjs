import { createRequire } from "node:module";
import { registerSkillDiscoveryActions } from "./actions/skills.mjs";
import { registerManagementActions } from "./actions/management.mjs";

const require = createRequire(import.meta.url);
const { SKILLS_REGISTRY_URL } = require("@js-eyes/protocol");
const {
  createSkillTrustStore,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  planSkillInstall,
  resolveSkillSources,
  skillToolActionName,
} = require("@js-eyes/skill-install/skills");
const { SkillHostService } = require("@js-eyes/skill-runtime");
const nodeFs = require("node:fs");
const nodePath = require("node:path");

const PLUGIN_DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

export function resolveSkillRoot(pluginDir = PLUGIN_DIR) {
  const normalizedDir = process.platform === "win32"
    ? pluginDir.replace(/^\//, "")
    : pluginDir;

  const candidates = [
    nodePath.resolve(normalizedDir, ".."),
    nodePath.resolve(normalizedDir, "..", ".."),
    normalizedDir,
  ];

  const withSkillsDir = candidates.find((candidate) =>
    nodeFs.existsSync(nodePath.join(candidate, "skills")));
  if (withSkillsDir) {
    return withSkillsDir;
  }

  return candidates.find((candidate) =>
    nodeFs.existsSync(nodePath.join(candidate, "package.json"))) || normalizedDir;
}

export const SKILL_ROOT = resolveSkillRoot();
export const DEFAULT_REGISTRY = SKILLS_REGISTRY_URL;

export {
  createSkillTrustStore,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  planSkillInstall,
  resolveSkillSources,
  skillToolActionName,
};

/**
 * Wire skill-install discovery/install actions, SkillHostService, and reload admin.
 *
 * Install/doctor-class operations prefer the CLI (`js-eyes skills …`); this
 * module keeps OpenClaw's in-process discovery, trust, and reload surface only.
 * Together with server-lifecycle.mjs, this is the only OpenClaw path that
 * should touch createServer / @js-eyes/skill-install.
 */
export function setupSkillsAdmin({
  api,
  builtinToolNames = [],
  chmodBestEffort,
  ensureBot,
  effectiveSkillConfig,
  fullRuntime,
  getActiveServer,
  hostVersion,
  loadConfig,
  loadEffectiveSkillConfig,
  nodeFs: fs = nodeFs,
  nodePath: pathMod = nodePath,
  registerCoreAction,
  resolveExtraSkillDirs,
  runtimePaths,
  setConfigValue,
  skillsDir,
  skillsRegistryUrl,
  state,
  textResult,
  wrapSensitiveTool,
}) {
  const skillTrustStore = createSkillTrustStore({
    filePath: pathMod.join(runtimePaths.configDir, "skill-trust.json"),
  });

  registerSkillDiscoveryActions({
    api,
    chmodBestEffort,
    discoverSkillsFromSources,
    fetchSkillsRegistry,
    loadConfig,
    nodeFs: fs,
    nodePath: pathMod,
    planSkillInstall,
    registerCoreAction,
    resolveSkillSources,
    runtimePaths,
    skillToolActionName,
    skillsDir,
    skillsRegistryUrl,
    textResult,
  });

  state.skillHostService = new SkillHostService(effectiveSkillConfig, {
    configLoader: loadEffectiveSkillConfig,
    skillsDir,
    extrasProvider: resolveExtraSkillDirs,
    setConfigValue: (key, value) => setConfigValue(key, value),
    logger: api.logger,
    invocationSource: "openclaw",
    hostVersion,
    browserFactory: () => ensureBot(),
    disposeBrowser: false,
    trustStore: skillTrustStore,
    registryOptions: {
      wrapSensitiveTool,
      builtinToolNames,
    },
  });
  state.skillRegistry = state.skillHostService.createRegistry();

  if (fullRuntime) {
    const initPromise = state.skillHostService.ensureReady().catch((error) => {
      api.logger.warn(`[js-eyes] Skill host init failed: ${error.message}`);
    });
    void initPromise;
  }

  registerManagementActions({
    getActiveServer,
    registerCoreAction,
    skillHostService: state.skillHostService,
  });

  return {
    skillHostService: state.skillHostService,
    skillRegistry: state.skillRegistry,
    skillTrustStore,
  };
}
