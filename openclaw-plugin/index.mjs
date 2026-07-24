import { createRequire } from "node:module";
import { patchWindowsHide } from "./windows-hide-patch.mjs";

patchWindowsHide();

const require = createRequire(import.meta.url);
const manifest = require("./openclaw.plugin.json");
const {
  BrowserAutomation,
  PolicyBlockError,
  ServerPolicyError,
} = require("../packages/client-sdk");
const { loadConfig, setConfigValue } = require("../packages/config");
const { createServer } = require("../packages/server-core");
const { SENSITIVE_TOOL_NAMES, SKILLS_REGISTRY_URL, resolveSecurityConfig } = require("../packages/protocol");
const {
  createSkillRegistry,
  createSkillTrustStore,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  planSkillInstall,
  resolveSkillSources,
  skillToolActionName,
} = require("../packages/protocol/skills");
const { ensureRuntimePaths, chmodBestEffort } = require("../packages/runtime-paths");
const { ensureToken } = require("../packages/runtime-paths/token.js");
import { createAuthHelpers } from "./auth.mjs";
import { ensureNativeHost, logNativeHostResult } from "./native-host-setup.mjs";
import { createSharedServerManager } from "./shared-server.mjs";
import { createHotReloadWatchers } from "./watchers.mjs";
import { createRegistrationContext } from "./registration-context.mjs";
import { registerPluginCli } from "./cli-registration.mjs";
import { createToolPolicy } from "./tool-policy.mjs";
import { registerServerService } from "./server-service.mjs";
import { registerToolRouter } from "./tool-router.mjs";
import { createPluginLifecycle } from "./lifecycle.mjs";
import { registerBrowserActions } from "./actions/browser.mjs";
import { registerSkillDiscoveryActions } from "./actions/skills.mjs";
import { registerManagementActions } from "./actions/management.mjs";
import { createSkillRuntimeOptions } from "./skill-runtime-options.mjs";
import { resolveOpenClawSkillConfig } from "./skill-config.mjs";

const nodeCrypto = require("node:crypto");
const nodeFs = require("node:fs");
const nodePath = require("node:path");

const PLUGIN_DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

function resolveSkillRoot() {
  const pluginDir = process.platform === "win32"
    ? PLUGIN_DIR.replace(/^\//, "")
    : PLUGIN_DIR;

  const candidates = [
    nodePath.resolve(pluginDir, ".."),
    nodePath.resolve(pluginDir, "..", ".."),
    pluginDir,
  ];

  const withSkillsDir = candidates.find((candidate) =>
    nodeFs.existsSync(nodePath.join(candidate, "skills")));
  if (withSkillsDir) {
    return withSkillsDir;
  }

  return candidates.find((candidate) =>
    nodeFs.existsSync(nodePath.join(candidate, "package.json"))) || pluginDir;
}

const SKILL_ROOT = resolveSkillRoot();
const DEFAULT_REGISTRY = SKILLS_REGISTRY_URL;
const BUILTIN_TOOL_NAMES = [];

function resolvePluginEntry(definition) {
  try {
    const sdk = require("openclaw/plugin-sdk/plugin-entry");
    if (typeof sdk.definePluginEntry === "function") {
      return sdk.definePluginEntry(definition);
    }
  } catch {
    // Fallback for local development without the OpenClaw SDK package installed.
  }
  return definition.register;
}

const sharedServer = createSharedServerManager(createServer);
const lifecycle = createPluginLifecycle(sharedServer);

function isFullRegistration(api) {
  const mode = api.registrationMode;
  return mode === undefined || mode === "full";
}

function register(api) {
  const fullRuntime = isFullRegistration(api);
  const mode = api.registrationMode ?? "full";
  let previousTeardown = lifecycle.beginRegistration(api);

  async function consumePreviousTeardown() {
    if (!previousTeardown) return;
    await previousTeardown;
    previousTeardown = null;
  }

  const {
    autoStart, effectiveSkillConfig, externalSkills, hostConfig,
    loadEffectiveSkillConfig, pluginConfig: pluginCfg, requestTimeout,
    resolveCurrentSkillSources, resolveExtraSkillDirs, serverHost, serverPort,
    skillSources, skillsDir, skillsRegistryUrl,
  } = resolveOpenClawSkillConfig({
    api, defaultRegistry: DEFAULT_REGISTRY, loadConfig, nodePath,
    resolveSkillSources, skillRoot: SKILL_ROOT,
  });

  const runtimePaths = ensureRuntimePaths();
  const skillTrustStore = createSkillTrustStore({
    filePath: nodePath.join(runtimePaths.configDir, "skill-trust.json"),
  });
  const security = resolveSecurityConfig(hostConfig);

  const { getServerToken, getLocalRequestHeaders } = createAuthHelpers(serverHost);
  const registration = createRegistrationContext({
    api,
    BrowserAutomation,
    getServerToken,
    requestTimeout,
    serverHost,
    serverPort,
    sharedServer,
  });
  const { ensureBot, getActiveServer, state, teardownRegistration, teardownSidecars } = registration;

  const {
    normalizeSkillAction,
    policyTextResultOrThrow,
    textResult,
    wrapSensitiveTool,
  } = createToolPolicy({
    api,
    chmodBestEffort,
    nodeCrypto,
    nodeFs,
    nodePath,
    PolicyBlockError,
    runtimePaths,
    security,
    ServerPolicyError,
    sensitiveToolDefaults: SENSITIVE_TOOL_NAMES,
  });

  const coreActions = new Map();

  function registerCoreAction(action, definition) {
    coreActions.set(
      action,
      wrapSensitiveTool({ ...definition, name: action }, { source: 'builtin' }),
    );
  }

  registerServerService({
    api,
    autoStart,
    clearCurrentRegistration: lifecycle.clearCurrentRegistration,
    consumePreviousTeardown,
    ensureNativeHost,
    ensureToken,
    fullRuntime,
    hostConfig,
    logNativeHostResult,
    pluginConfig: effectiveSkillConfig,
    requestTimeout,
    runtimePaths,
    security,
    serverHost,
    serverPort,
    sharedServer,
    state,
    teardownRegistration,
  });

  registerBrowserActions({ ensureBot, policyTextResultOrThrow, registerCoreAction, textResult });

  registerSkillDiscoveryActions({ api, chmodBestEffort, discoverSkillsFromSources, fetchSkillsRegistry, loadConfig, nodeFs, nodePath, planSkillInstall, registerCoreAction, resolveSkillSources, runtimePaths, skillToolActionName, skillsDir, skillsRegistryUrl, textResult });

  state.skillRegistry = createSkillRegistry({
    hostConfig: effectiveSkillConfig,
    wrapSensitiveTool,
    builtinToolNames: BUILTIN_TOOL_NAMES,
    skillsDir,
    extrasProvider: resolveExtraSkillDirs,
    configLoader: loadEffectiveSkillConfig,
    setConfigValue: (key, value) => setConfigValue(key, value),
    logger: api.logger,
    externalSkillPolicy: externalSkills.policy || "legacy",
    externalSkillPolicyProvider: () => (
      pluginCfg.externalSkills?.policy || loadConfig().externalSkills?.policy || "legacy"
    ),
    trustChecker: (skill) => skillTrustStore.isApproved(skill),
    ...createSkillRuntimeOptions({
      hostVersion: manifest.version,
      loadConfig,
      logger: api.logger,
      pluginConfig: effectiveSkillConfig,
      requestTimeout,
      serverHost,
      serverPort,
      trustStore: skillTrustStore,
    }),
  });

  if (fullRuntime) {
    const initPromise = state.skillRegistry.init().catch((error) => {
      api.logger.warn(`[js-eyes] SkillRegistry init failed: ${error.message}`);
    });
    void initPromise;
  }

  registerManagementActions({ getActiveServer, registerCoreAction, skillRegistry: state.skillRegistry });

  registerToolRouter({
    api,
    coreActions,
    getSkillRegistry: () => state.skillRegistry,
    normalizeSkillAction,
    textResult,
  });

  state.watchers = createHotReloadWatchers({
    api,
    fullRuntime,
    pluginConfig: effectiveSkillConfig,
    runtimePaths,
    skillRegistry: state.skillRegistry,
    skillSources,
    getSkillSources: resolveCurrentSkillSources,
  });

  registerPluginCli({
    api,
    createServer,
    exitCli: lifecycle.exitCli,
    getLocalRequestHeaders,
    installCliExitHandlers: lifecycle.installCliExitHandlers,
    serverHost,
    serverPort,
    sharedServer,
    state,
  });

  lifecycle.setCurrentRegistration({
    api,
    mode,
    hadSidecars: fullRuntime,
    teardownSidecars,
    teardown: teardownRegistration,
  });
}

const definition = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  register,
};

export default resolvePluginEntry(definition);
