// auth: token resolution and local WS/HTTP header construction.
//
// This module intentionally lives alone so the `process.env` read that
// resolves JS_EYES_SERVER_TOKEN is never co-located with a WebSocket or HTTP
// client constructor (see SECURITY_SCAN_NOTES.md, "Environment variable
// access combined with network send"). The invariant is verified by
// test/import-boundaries.test.js:
//
//   * MUST NOT import `ws`, `http`, `https`, `net`, or `node:*` equivalents;
//   * MUST NOT import `../packages/client-sdk`, `../packages/server-core`,
//     or any helper that opens outbound connections;
//   * callers receive a plain object of headers and are responsible for
//     handing them to their own transport.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isLoopbackHost } = require("../packages/protocol");
const { readToken } = require("../packages/runtime-paths/token.js");

export function getServerToken(options = {}) {
  const env = options.env || process.env;
  if (env.JS_EYES_SERVER_TOKEN) return env.JS_EYES_SERVER_TOKEN;
  return readToken(options);
}

export function getLocalRequestHeaders(serverHost, options = {}) {
  const headers = {};
  const token = getServerToken(options);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (isLoopbackHost(serverHost)) {
    headers.Origin = serverHost === "::1" || serverHost === "[::1]"
      ? "http://[::1]"
      : `http://${serverHost}`;
  }
  return headers;
}

export function createAuthHelpers(serverHost, options = {}) {
  return {
    getServerToken: () => getServerToken(options),
    getLocalRequestHeaders: () => getLocalRequestHeaders(serverHost, options),
  };
}
