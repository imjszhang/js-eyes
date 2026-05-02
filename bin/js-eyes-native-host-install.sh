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
# In addition to writing the browser native-messaging manifest + launcher,
# this script also runs `js-eyes server token init` (idempotent) so that a
# fresh install has a `~/.js-eyes/runtime/server.token` file ready before the
# extension's "Sync Token From Host" / 从本机同步 button is used. Without
# that file the host returns `token-missing` and the popup falls back to
# manual paste. Pass `--skip-token-init` (or set
# JS_EYES_SKIP_TOKEN_INIT=1) to opt out.
#
# Usage:
#   bin/js-eyes-native-host-install.sh [--skip-token-init] \
#                                      [--browser all|chrome|firefox|edge|brave|chromium|chrome-canary]
#
# Anything passed after the script name (other than --skip-token-init) is
# forwarded to the CLI's `native-host install` verbatim.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI_ENTRY="${REPO_ROOT}/apps/cli/bin/js-eyes.js"

if [ ! -f "${CLI_ENTRY}" ]; then
  echo "[js-eyes] CLI entry not found at ${CLI_ENTRY}" >&2
  echo "[js-eyes] Run this script from a checked-out js-eyes repository (or a local npm-installed copy)." >&2
  exit 1
fi

SKIP_TOKEN_INIT="${JS_EYES_SKIP_TOKEN_INIT:-0}"
PASS_THROUGH_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --skip-token-init)
      SKIP_TOKEN_INIT=1
      ;;
    *)
      PASS_THROUGH_ARGS+=("$arg")
      ;;
  esac
done

BROWSER_DEFAULT="all"
if [ "${#PASS_THROUGH_ARGS[@]}" -eq 0 ]; then
  node "${CLI_ENTRY}" native-host install --browser "${BROWSER_DEFAULT}"
else
  node "${CLI_ENTRY}" native-host install "${PASS_THROUGH_ARGS[@]}"
fi

if [ "${SKIP_TOKEN_INIT}" != "1" ]; then
  # `server token init` is idempotent — it's a no-op when the file already
  # exists. Running it here closes the gap where a brand-new install has the
  # native-messaging host registered but no token file for it to read.
  node "${CLI_ENTRY}" server token init
fi
