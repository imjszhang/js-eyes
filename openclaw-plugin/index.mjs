import { createRequire } from "node:module";
import { patchWindowsHide } from "./windows-hide-patch.mjs";

patchWindowsHide();

const require = createRequire(import.meta.url);
const manifest = require("./openclaw.plugin.json");
const {
  BrowserAutomation,
  PolicyBlockError,
  ServerPolicyError,
} = require("@js-eyes/client-sdk");
const { loadConfig, setConfigValue } = require("@js-eyes/config");
const { SENSITIVE_TOOL_NAMES, resolveSecurityConfig } = require("@js-eyes/protocol");
import { createAuthHelpers } from "./auth.mjs";
import { ensureNativeHost, logNativeHostResult } from "./native-host-setup.mjs";
import { createHotReloadWatchers } from "./watchers.mjs";
import { createRegistrationContext } from "./registration-context.mjs";
import { registerPluginCli } from "./cli-registration.mjs";
import { createToolPolicy } from "./tool-policy.mjs";
import { registerToolRouter } from "./tool-router.mjs";
import { createPluginLifecycle } from "./lifecycle.mjs";
import { registerBrowserActions } from "./actions/browser.mjs";
import { resolveOpenClawSkillConfig } from "./skill-config.mjs";
import {
  chmodBestEffort,
  createServer,
  ensureRuntimePaths,
  registerJsEyesServerService,
  sharedServer,
} from "./server-lifecycle.mjs";
import {
  DEFAULT_REGISTRY,
  SKILL_ROOT,
  resolveSkillSources,
  setupSkillsAdmin,
} from "./skills-admin.mjs";

const nodeCrypto = require("node:crypto");
const nodeFs = require("node:fs");
const nodePath = require("node:path");

const BUILTIN_TOOL_NAMES = [];
const lifecycle = createPluginLifecycle(sharedServer);

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
    autoStart, effectiveSkillConfig, hostConfig,
    loadEffectiveSkillConfig, requestTimeout,
    resolveCurrentSkillSources, resolveExtraSkillDirs, serverHost, serverPort,
    skillSources, skillsDir, skillsRegistryUrl,
  } = resolveOpenClawSkillConfig({
    api, defaultRegistry: DEFAULT_REGISTRY, loadConfig, nodePath,
    resolveSkillSources, skillRoot: SKILL_ROOT,
  });

  const runtimePaths = ensureRuntimePaths();
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

  registerJsEyesServerService({
    api,
    autoStart,
    clearCurrentRegistration: lifecycle.clearCurrentRegistration,
    consumePreviousTeardown,
    ensureNativeHost,
    fullRuntime,
    hostConfig,
    logNativeHostResult,
    pluginConfig: effectiveSkillConfig,
    requestTimeout,
    runtimePaths,
    security,
    serverHost,
    serverPort,
    state,
    teardownRegistration,
  });

  registerBrowserActions({ ensureBot, policyTextResultOrThrow, registerCoreAction, textResult });

  setupSkillsAdmin({
    api,
    builtinToolNames: BUILTIN_TOOL_NAMES,
    chmodBestEffort,
    ensureBot,
    effectiveSkillConfig,
    fullRuntime,
    getActiveServer,
    hostVersion: manifest.version,
    loadConfig,
    loadEffectiveSkillConfig,
    nodeFs,
    nodePath,
    registerCoreAction,
    resolveExtraSkillDirs,
    runtimePaths,
    setConfigValue,
    skillsDir,
    skillsRegistryUrl,
    state,
    textResult,
    wrapSensitiveTool,
  });

  registerToolRouter({
    api,
    coreActions,
    getSkillHostService: () => state.skillHostService,
    normalizeSkillAction,
    textResult,
  });

  state.watchers = createHotReloadWatchers({
    api,
    fullRuntime,
    pluginConfig: effectiveSkillConfig,
    runtimePaths,
    skillHostService: state.skillHostService,
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
