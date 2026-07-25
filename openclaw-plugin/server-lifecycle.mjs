import { createRequire } from "node:module";
import { createSharedServerManager } from "./shared-server.mjs";
import { registerServerService } from "./server-service.mjs";

const require = createRequire(import.meta.url);
const { createServer } = require("@js-eyes/server-core");
const { ensureRuntimePaths, chmodBestEffort } = require("@js-eyes/runtime-paths");
const { ensureToken } = require("@js-eyes/runtime-paths/token.js");

/** Shared reference-counted JS Eyes server used across OpenClaw registrations. */
export const sharedServer = createSharedServerManager(createServer);

export {
  chmodBestEffort,
  createServer,
  ensureRuntimePaths,
  ensureToken,
};

/**
 * Register the OpenClaw service that starts/stops the shared local server.
 * Token and shared-server defaults come from this module unless overridden.
 */
export function registerJsEyesServerService(options) {
  return registerServerService({
    ...options,
    ensureToken: options.ensureToken ?? ensureToken,
    sharedServer: options.sharedServer ?? sharedServer,
  });
}
