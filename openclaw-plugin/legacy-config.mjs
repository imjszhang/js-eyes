import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";

export function getOpenClawConfigPath(options = {}) {
  const env = options.env || process.env;
  const home = options.home || nodeOs.homedir();

  if (env.OPENCLAW_CONFIG_PATH) {
    return nodePath.resolve(env.OPENCLAW_CONFIG_PATH);
  }
  if (env.OPENCLAW_STATE_DIR) {
    return nodePath.resolve(env.OPENCLAW_STATE_DIR, "openclaw.json");
  }
  if (env.OPENCLAW_HOME) {
    return nodePath.resolve(env.OPENCLAW_HOME, ".openclaw", "openclaw.json");
  }
  return nodePath.join(home, ".openclaw", "openclaw.json");
}

export function readLegacyOpenClawSkillState(options = {}) {
  const configPath = options.configPath || getOpenClawConfigPath(options);
  if (!nodeFs.existsSync(configPath)) return {};

  let config;
  try {
    config = JSON.parse(nodeFs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }

  const entries = config?.plugins?.entries;
  if (!entries || typeof entries !== "object") return {};

  const state = {};
  for (const [skillId, entry] of Object.entries(entries)) {
    if (skillId === "js-eyes") continue;
    if (!entry || typeof entry !== "object" || entry.enabled === undefined) continue;
    state[skillId] = entry.enabled !== false;
  }
  return state;
}
