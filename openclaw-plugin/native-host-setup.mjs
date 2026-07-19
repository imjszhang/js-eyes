import { createRequire } from "node:module";
import nodePath from "node:path";

const require = createRequire(import.meta.url);

const nativeHostInstaller = require("../apps/native-host/src/installer");
const {
  CHROMIUM_BROWSERS,
  FIREFOX_BROWSERS,
  resolveBrowsers,
} = require("../apps/native-host/src/paths");
const {
  CHROME_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
} = require("../apps/native-host/src/extension-ids");

const DEFAULT_NATIVE_HOST_CONFIG = Object.freeze({
  autoInstall: true,
  browser: "all",
  repairStale: true,
  warnOnly: false,
});

const REPAIRABLE_CODES = new Set([
  "missing-manifest",
  "missing-launcher",
  "invalid-manifest",
  "stale-launcher-path",
  "allowed-extension-mismatch",
]);

function normalizePathForCompare(value) {
  if (!value || typeof value !== "string") return "";
  const normalized = nodePath.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isChromiumBrowser(browser) {
  return CHROMIUM_BROWSERS.includes(browser);
}

function isFirefoxBrowser(browser) {
  return FIREFOX_BROWSERS.includes(browser);
}

function hasExpectedAllowedExtension(status) {
  const manifest = status?.manifest;
  if (!manifest || typeof manifest !== "object") return false;

  if (isFirefoxBrowser(status.browser)) {
    return Array.isArray(manifest.allowed_extensions)
      && manifest.allowed_extensions.includes(FIREFOX_EXTENSION_ID);
  }

  if (isChromiumBrowser(status.browser)) {
    const expectedOrigin = `chrome-extension://${CHROME_EXTENSION_ID}/`;
    return Array.isArray(manifest.allowed_origins)
      && manifest.allowed_origins.includes(expectedOrigin);
  }

  return false;
}

export function resolveNativeHostConfig(config = {}) {
  /** @type {{ autoInstall?: boolean, browser?: string, repairStale?: boolean, warnOnly?: boolean }} */
  const source = config && typeof config === "object" ? config : {};
  return {
    autoInstall: source.autoInstall ?? DEFAULT_NATIVE_HOST_CONFIG.autoInstall,
    browser: source.browser || DEFAULT_NATIVE_HOST_CONFIG.browser,
    repairStale: source.repairStale ?? DEFAULT_NATIVE_HOST_CONFIG.repairStale,
    warnOnly: source.warnOnly ?? DEFAULT_NATIVE_HOST_CONFIG.warnOnly,
  };
}

export function classifyNativeHostStatus(status) {
  if (!status || typeof status !== "object") {
    return { ok: false, code: "invalid-status", reason: "status object is missing" };
  }

  if (!status.installed) {
    return { ok: false, code: "missing-manifest", reason: "native messaging manifest is missing" };
  }

  if (!status.manifest || typeof status.manifest !== "object") {
    return { ok: false, code: "invalid-manifest", reason: "native messaging manifest cannot be parsed" };
  }

  if (!status.launcherExists) {
    return { ok: false, code: "missing-launcher", reason: "native messaging launcher is missing" };
  }

  if (normalizePathForCompare(status.manifest.path) !== normalizePathForCompare(status.launcherPath)) {
    return { ok: false, code: "stale-launcher-path", reason: "manifest points at a different launcher path" };
  }

  if (!hasExpectedAllowedExtension(status)) {
    return { ok: false, code: "allowed-extension-mismatch", reason: "manifest does not allow the JS Eyes extension id" };
  }

  return { ok: true, code: "ok", reason: "native host registration is healthy" };
}

export function shouldRepairNativeHost(classification, config = {}) {
  if (!classification || classification.ok) return false;
  if (!REPAIRABLE_CODES.has(classification.code)) return false;
  if (config.warnOnly) return false;
  if (classification.code === "stale-launcher-path" || classification.code === "allowed-extension-mismatch") {
    return config.repairStale !== false;
  }
  return true;
}

export function summarizeNativeHostResult(result) {
  if (!result || result.skipped) {
    return "[js-eyes] Native host auto-install disabled";
  }

  const ok = result.statuses.filter((item) => item.classification.ok).map((item) => item.browser);
  const repaired = result.repairs.filter((item) => item.status === "installed").map((item) => item.browser);
  const failed = result.repairs.filter((item) => item.status !== "installed");
  const repairedSet = new Set(repaired);
  const unresolved = result.statuses.filter((item) =>
    !item.classification.ok && !repairedSet.has(item.browser)
  );
  const warnings = [];

  if (ok.length > 0) {
    warnings.push(`OK: ${ok.join(", ")}`);
  }
  if (repaired.length > 0) {
    warnings.push(`installed/repaired: ${repaired.join(", ")}`);
  }
  if (failed.length > 0) {
    warnings.push(`failed: ${failed.map((item) => `${item.browser} (${item.error || item.status})`).join(", ")}`);
  }
  if (unresolved.length > 0) {
    warnings.push(`needs attention: ${unresolved.map((item) => `${item.browser} (${item.classification.code})`).join(", ")}`);
  }

  return `[js-eyes] Native host ${warnings.join("; ") || "checked"}`;
}

export function ensureNativeHost(config = {}, options = {}) {
  const resolved = resolveNativeHostConfig(config);
  const installer = options.installer || nativeHostInstaller;

  if (resolved.autoInstall === false) {
    return {
      skipped: true,
      config: resolved,
      statuses: [],
      repairs: [],
    };
  }

  // Validate selector early so startup logs surface config typos before writing anything.
  const browsers = resolveBrowsers(resolved.browser);
  const statusByBrowser = new Map(
    installer.statusBrowsers(resolved.browser).map((status) => [status.browser, status])
  );

  const statuses = browsers.map((browser) => {
    const status = statusByBrowser.get(browser) || { browser, installed: false };
    const classification = classifyNativeHostStatus(status);
    return { browser, status, classification };
  });

  const repairs = [];
  for (const item of statuses) {
    if (!shouldRepairNativeHost(item.classification, resolved)) continue;
    const repairResults = installer.installBrowsers(item.browser);
    repairs.push(...repairResults);
  }

  return {
    skipped: false,
    config: resolved,
    statuses,
    repairs,
  };
}

export function logNativeHostResult(result, logger = console) {
  const message = summarizeNativeHostResult(result);
  const repaired = result?.repairs?.some((item) => item.status === "installed");
  const failed = result?.repairs?.some((item) => item.status !== "installed");
  const repairedBrowsers = new Set(
    (result?.repairs || []).filter((item) => item.status === "installed").map((item) => item.browser)
  );
  const unresolved = result?.statuses?.some((item) =>
    !item.classification.ok && !repairedBrowsers.has(item.browser)
  );

  if (failed || unresolved) {
    logger.warn?.(message);
  } else {
    logger.info?.(message);
  }

  if (repaired) {
    logger.warn?.('[js-eyes] Native host changed; restart the browser before using "Sync Token From Host".');
  }
}
