#!/usr/bin/env bash
# js-eyes-server-start.sh — start the JS Eyes WebSocket/HTTP server locally.
#
# Unlike `npx js-eyes server start`, this script never contacts the npm
# registry or downloads anything: it shells out to the repo-local CLI using
# the currently-checked-out tree.
#
# Usage:
#   bin/js-eyes-server-start.sh [--host localhost] [--port 18080]
#
# Extra arguments are forwarded to `js-eyes server start` verbatim.
# `--foreground` is always included so the server runs in the current terminal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI_ENTRY="${REPO_ROOT}/apps/cli/bin/js-eyes.js"

if [ ! -f "${CLI_ENTRY}" ]; then
  echo "[js-eyes] CLI entry not found at ${CLI_ENTRY}" >&2
  echo "[js-eyes] Run this script from a checked-out js-eyes repository (or a local npm-installed copy)." >&2
  exit 1
fi

cd "${REPO_ROOT}"
exec node "${CLI_ENTRY}" server start --foreground "$@"
