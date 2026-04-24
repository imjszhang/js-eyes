#!/usr/bin/env bash
# js-eyes-native-host-install.sh — recommended local launcher for installing
# the native-messaging host (macOS / Linux).
#
# Unlike `npx js-eyes native-host install`, this script never contacts the
# npm registry or downloads anything: it simply shells out to the repo-local
# CLI using the currently-checked-out tree. Use this when you've already
# cloned or npm-installed `js-eyes` locally and want to minimize the surface
# on which remote code could run during setup.
#
# Usage:
#   bin/js-eyes-native-host-install.sh [--browser all|chrome|firefox|edge|brave|chromium|chrome-canary]
#
# Anything passed after the script name is forwarded to the CLI verbatim.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI_ENTRY="${REPO_ROOT}/apps/cli/bin/js-eyes.js"

if [ ! -f "${CLI_ENTRY}" ]; then
  echo "[js-eyes] CLI entry not found at ${CLI_ENTRY}" >&2
  echo "[js-eyes] Run this script from a checked-out js-eyes repository (or a local npm-installed copy)." >&2
  exit 1
fi

BROWSER_DEFAULT="all"
if [ "$#" -eq 0 ]; then
  exec node "${CLI_ENTRY}" native-host install --browser "${BROWSER_DEFAULT}"
fi

exec node "${CLI_ENTRY}" native-host install "$@"
