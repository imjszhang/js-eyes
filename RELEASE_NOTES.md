# Release Notes

## v2.4.0

### Highlights
- **Native Messaging Token Injection**: New `apps/native-host` package and `js-eyes native-host <install|uninstall|status>` command register a Native Messaging host for Chrome, Edge, and Firefox on macOS, Linux, and Windows. The host returns `server.token` + `httpUrl` from the local CLI config so freshly installed extensions no longer need manual copy-paste.
- **Popup "Sync Token From Host" Button**: Chrome and Firefox popups expose a primary `sync-token-from-native` button that triggers the Native Messaging round-trip on demand; background scripts also attempt a silent sync on startup.
- **Streamlined Popup Surface**: The default extension popup now shows only connection status and the sync button. Server address, manual token paste, and Auto Connect are folded under an `<details>` "Advanced" section.
- **Legacy Auth Cleanup**: HMAC `auth_challenge` / `auth_result`, `computeHMAC`, `authSecretKey`, session-refresh timers, and the inline SSE fallback client are removed from both Chrome and Firefox extensions. Bearer tokens (2.2.0+) are now the sole authentication path.
- **Wire Protocol Unchanged**: No server / CLI breaking changes — existing automation clients keep working against a 2.4.0 server.

### Breaking Changes
- **Extension-only**: The "Authentication Key", "Debug Mode", "Connection Mode", "Server Type", "Preset Addresses", and legacy "Auth Status" controls are gone from the popup. Anything automation still expecting those extension messages (`save_auth_key`, `get_auth_status`, `session_expired`, etc.) must be updated.
- `EXTENSION_CONFIG.SSE` and `SECURITY.auth.*` blocks are removed from `extensions/chrome/config.js` and `extensions/firefox/config.js`.
- Storage keys `auth_secret_key` and `debugMode` are cleared silently on first launch of the 2.4.0 extension.

### Migration Notes
1. Upgrade the CLI: `npm install -g js-eyes@2.4.0`.
2. Install the Native Messaging host once per machine: `npx js-eyes native-host install --browser all` (or `--browser chrome|edge|firefox`).
3. Install the 2.4.0 browser extension (Chrome ZIP or Firefox XPI from this release, or from AMO when the public listing is live).
4. Open the extension popup and click **Sync Token From Host** — the popup will fill `wsUrl` / `httpBaseUrl` / bearer token automatically.
5. On restricted environments where Native Messaging is blocked, expand **Advanced** and paste the token manually; nothing else about the 2.2.0+ bearer flow has changed.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.4.0/js-eyes-chrome-v2.4.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.4.0/js-eyes-firefox-v2.4.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.4.0/js-eyes-skill-v2.4.0.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.4.0`
2. `js-eyes doctor` — confirm `server.token` / policy-engine output is unchanged from 2.3.x.
3. `js-eyes native-host install --browser all` to register the Native Messaging host used by the new extension popup.

#### OpenClaw
- Upgrade the CLI (`js-eyes`) to 2.4.0; the OpenClaw plugin keeps loading the shared protocol module unchanged. No config change required.

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.4.0.zip`, extract, load unpacked (or wait for the Chrome Web Store listing).
2. Open the popup → click **Sync Token From Host** — the popup auto-fills once `native-host install` has been run.
3. If Native Messaging is blocked by policy, expand **Advanced** and paste the token manually as in 2.3.x.

#### Firefox
1. Install `js-eyes-firefox-v2.4.0.xpi` (or update from AMO once the public listing is live).
2. Same popup flow: click **Sync Token From Host**, or fall back to the **Advanced** panel.

---

## v2.3.0

### Highlights
- **Policy Engine**: New declarative rules layer in `@js-eyes/client-sdk/policy` (task origin, canary taint, egress allowlist). `BrowserAutomation.attachPolicy(ctx)` wires it into every sink; unattached SDK callers keep passing through.
- **Pending Egress Queue**: Non-allowlisted `openUrl` calls become `runtime/pending-egress/<id>.json` records instead of executing. `js-eyes egress list|approve|allow|clear` manages the backlog.
- **Cookie Canaries**: Every returned cookie gets a `jse-c-<hex>` canary; sinks that serialize a tainted value or canary are soft-blocked as `taint-hit`.
- **Server-Side Fallback**: `packages/server-core/ws-handler.js` runs the same engine against raw automation WebSocket messages, covering external agents that bypass `client-sdk`.
- **Enforcement Levels**: `off` (audit only), `soft` (default; plan-only + audit), `strict` (hard reject). Controlled via `js-eyes security enforce <level>`, `config.security.enforcement`, or `JS_EYES_POLICY_ENFORCEMENT`.
- **HTTP Hardening**: server responses now carry `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Permissions-Policy: interest-cohort=()`.
- **Doctor Policy Report**: enforcement level, pending-egress backlog, most-recent soft-block, top-3 blocked tool/rule pairs, and skills with `platforms: ['*']` are all surfaced by `js-eyes doctor`.

### Breaking Changes
- None by default. `enforcement=soft` means existing workflows continue to work; violations produce plan-only / audit records.
- `strict` mode rejects tool calls whose tab / domain is outside the task scope; opt in only after reviewing `js-eyes doctor` and `js-eyes egress list`.

### Migration Notes
1. `js-eyes doctor` — read the new "Policy engine (2.3)" section. If you see a pending-egress backlog, run `js-eyes egress list` and approve or allow what you expect.
2. Skills that declare explicit `runtime.platforms` automatically get the tightest scope; skills with `['*']` stay on the weakest-protection path (reported by doctor).
3. If a production agent depends on calling sinks that touch off-scope origins, either declare the origins in `skill.contract.runtime.platforms`, set `config.security.egressAllowlist`, or keep `enforcement=soft`.
4. External WebSocket clients that bypass `client-sdk` should handle the new `pending-egress` / `POLICY_SOFT_BLOCK` response shapes.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.3.0/js-eyes-chrome-v2.3.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.3.0/js-eyes-firefox-v2.3.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.3.0/js-eyes-skill-v2.3.0.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.3.0`
2. `js-eyes doctor` — review the new `Policy engine (2.3)` block; the default `soft` mode is safe to keep.
3. Optional: `js-eyes security enforce strict` after you've verified there are no pending-egress items you care about.

#### OpenClaw
- Upgrade the CLI (`js-eyes`) to 2.3.0; the OpenClaw plugin auto-loads the shared protocol module, so the engine becomes active on the next tool invocation.

#### Browser Extensions
- Chrome / Edge / Firefox 2.3.0 extensions add a defensive guard so `pending-egress` / `POLICY_SOFT_BLOCK` server responses are never re-interpreted as instructions. No popup UI change.

---

## v2.2.0

### Highlights
- **Local Server Authentication**: Random bearer token generated on first start; WebSocket/HTTP clients must present it unless `security.allowAnonymous=true`.
- **Origin Allowlist + Loopback Enforcement**: Server rejects non-allowlisted `Origin` and refuses non-loopback host binds without `security.allowRemoteHost=true`.
- **Supply Chain Hardening**: `skills.json` entries ship with `sha256`/`size`, install is a two-phase `plan → approve → apply` flow, Zip Slip-safe extractor, `npm ci --ignore-scripts` with `package-lock.json` enforced.
- **Skill Integrity Pinning**: `.integrity.json` is written on install; `registerLocalSkills` verifies files on load; `js-eyes skills verify` and `js-eyes doctor` expose drift.
- **Sensitive Tool Consent Gateway**: `execute_script*`, `get_cookies*`, `upload_file*`, `inject_css`, `install_skill` default to `confirm` policy, with CLI `js-eyes consent` to approve/deny pending requests.
- **Extensions**: Popups expose a "Server Token" field, raw `eval` disabled by default (`allowRawEval=false`), `externally_connectable` narrowed to port 18080.
- **Audit Log**: JSONL at `logs/audit.log` with `js-eyes audit tail`.
- **Secure Defaults on Disk**: `config.json`, `server.token`, `audit.log`, and consent files write at `0600` (POSIX) or locked via `icacls` (Windows).

### Breaking Changes
- Clients that do not send a token are rejected unless the operator opts into `security.allowAnonymous=true`.
- `isSkillEnabled` defaults to `false`; installed skills must be re-enabled explicitly.
- Raw `<script>` payloads via `execute_script` are refused unless both host and extension set `allowRawEval=true`.
- Skill bundles downloaded without a `sha256` in the registry are refused by `install.sh`/`install.ps1`.
- `@main` / `refs/heads/main` CDN fallback URLs are no longer honored for skill downloads.

### Migration Notes
1. `js-eyes server token init` to (re)generate the token; share it with the browser extension popup and any automation clients.
2. Rebuild or re-install browser extensions (2.2.0) so the popup exposes the "Server Token" field.
3. `js-eyes skills verify` to confirm installed skills pass integrity; re-run `js-eyes skills install <id>` + `skills approve <id>` + `skills enable <id>` if any drift is reported.
4. Operators running without auth (testing / legacy clients) may set `security.allowAnonymous=true`, but every anonymous connection is audited and `js-eyes doctor` will flag the insecure state.
5. Review `SECURITY.md` and the [2.2.0 migration guide in RELEASE.md](RELEASE.md#220-migration-guide-security-hardening) before rolling out.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.2.0/js-eyes-chrome-v2.2.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.2.0/js-eyes-firefox-v2.2.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.2.0/js-eyes-skill-v2.2.0.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.2.0`
2. `js-eyes server token init` (or inspect existing token via `js-eyes server token show --reveal`)
3. `js-eyes server start`, then `js-eyes doctor` to verify the hardened defaults

#### OpenClaw
1. Keep only the main `js-eyes/openclaw-plugin` in `plugins.load.paths`
2. Ensure `security.toolPolicies` matches your risk appetite (defaults: `execute_script*` / `get_cookies*` / `upload_file*` / `install_skill` → `confirm`)
3. Install skills via `js_eyes_install_skill` — pending plans must be approved with `js-eyes skills approve <id>` before they take effect

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.2.0.zip`, extract, load unpacked
2. Open the popup and paste the server token into "Server Token (2.2.0+)"

#### Firefox
1. Download `js-eyes-firefox-v2.2.0.xpi` and install
2. Open the popup and paste the server token into "Server Token (2.2.0+)"

## v2.0.0

### Changes
- **Single OpenClaw Plugin Model**: OpenClaw now loads only the main `js-eyes` plugin. Installed extension skills are discovered and registered by the main plugin at startup.
- **Breaking Change - No Child Plugin Wrappers**: Extension skills no longer ship their own `openclaw-plugin` wrapper files or require separate `plugins.load.paths` entries.
- **Host-Owned Skill Enablement**: Skill enable/disable state now lives in JS Eyes runtime config, with compatibility migration from legacy child plugin `enabled` entries.
- **Updated Install Flow**: `js_eyes_install_skill` and `js-eyes skills install` now install, enable, and prepare skills for host-side auto-loading after an OpenClaw restart or new session.
- **Version Line Bump**: Monorepo packages, extension manifests, plugin metadata, and extension skill packages are aligned on `2.0.0`.

### Migration Notes
- Keep only the main `js-eyes` plugin registered in OpenClaw.
- Do not add child skill plugin paths manually.
- Restart OpenClaw or open a new session after installing or enabling a skill.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.0.0/js-eyes-chrome-v2.0.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.0.0/js-eyes-firefox-v2.0.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.0.0/js-eyes-skill-v2.0.0.zip)

### Installation Instructions

#### npm CLI
1. Install `js-eyes` with `npm install -g js-eyes@2.0.0`
2. Run `js-eyes --help` to verify the CLI is available
3. Use `js-eyes skills list` or `js-eyes server start` to verify the local runtime

#### OpenClaw
1. Keep `plugins.load.paths` pointed only at the main `js-eyes/openclaw-plugin`
2. Ensure `plugins.entries["js-eyes"].enabled` is `true`
3. Install skills through `js_eyes_install_skill` or `js-eyes skills install <skillId>`
4. Restart OpenClaw or start a new session so the main plugin can auto-load enabled skills

## v1.5.1

### Changes
- **Unified Runtime Directory**: The published CLI now uses `~/.js-eyes` as the default runtime home on macOS, Linux, and Windows.
- **Automatic Legacy Migration**: Existing runtime data is migrated automatically from the old platform-specific directories on first run.
- **Version Sync Cleanup**: Release-facing docs, badges, manifests, popup labels, and bundle references are aligned on `1.5.1`.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v1.5.1/js-eyes-chrome-v1.5.1.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v1.5.1/js-eyes-firefox-v1.5.1.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v1.5.1/js-eyes-skill-v1.5.1.zip)

### Installation Instructions

#### npm CLI
1. Install `js-eyes` with `npm install -g js-eyes@1.5.1`
2. Run `js-eyes --help` to verify the CLI is available
3. Use `js-eyes server start` or `js-eyes skills list` to verify the local runtime

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.5.1.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.5.1.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.4.0

### Changes
- **Auto Server Discovery**: Extension auto-detects server type, capabilities, and WebSocket endpoint from a single HTTP URL via `/api/browser/config`
- **Unified Server URL**: Single `SERVER_URL` replaces separate `WEBSOCKET_SERVER_URL` and `HTTP_SERVER_URL` — WebSocket address is auto-discovered
- **Adaptive Authentication**: Auth flow is now message-driven, reacting to server's first message instead of guessing with a timeout
- **Multi-server Support**: Full support for both lightweight (`js-eyes/server`) and full-featured (`deepseek-cowork`) server backends
- **Built-in Server**: New lightweight Node.js server (`server/`) with HTTP + WebSocket on a single port, browser client management, and tab tracking
- **Server Type Display**: Popup UI now shows detected server name/version and supported capabilities
- **Tolerant Health Check**: `HealthChecker` accepts HTTP 503 as valid "critical" response, supports multiple response formats
- **CLI Toolchain**: New `cli/` module with build, bump, commit, sync, and release commands (cross-platform, i18n support)
- **Landing Page**: New project site built from `src/` to `docs/` with i18n support
- **Test Suite**: Added unit tests for server WebSocket handler and Firefox extension utilities
- **Bug Fixes**: Fixed SSE false activation, health check 503 handling, and port mismatch issues

### Downloads
- [Chrome Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.4.0/js-eyes-chrome-v1.4.0.zip)
- [Firefox Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.4.0/js-eyes-firefox-v1.4.0.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.4.0.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.4.0.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.3.5

### Changes
- Synced Chrome extension with Firefox extension feature parity
- Connection orphan protection: connection instance tracking (`connectionId`) and `_cleanupSocket` for proper cleanup
- Message handling: added rate limit, deduplication, and queue checks before processing requests
- Session management: `session_expired` and `session_expiring` handling for session refresh
- Server config: use `extensionRateLimit` instead of `callbackQueryLimit` for rate limit sync
- Cleanup task: send timeout response for expired requests, run every 10 seconds
- `handleOpenUrl`: URL deduplication, timeout protection, URL-tab cache
- `handleGetHtml` / `handleExecuteScript`: timeout protection via `withTimeout`
- `reconnectWithNewSettings`: use `_cleanupSocket` for proper connection cleanup
- Stop health checker on WebSocket close/error

### Downloads
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v1.3.5/js-eyes-chrome-v1.3.5.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v1.3.5/js-eyes-firefox-v1.3.5.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.3.5.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.3.5.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.3.4

### Changes
- Enhanced connection management: Improved socket cleanup and connection instance tracking to prevent orphan connections
- Minor adjustments to background script for better stability and error handling

### Downloads
- [Chrome Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.4/js-eyes-chrome-v1.3.4.zip)
- [Firefox Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.4/js-eyes-firefox-v1.3.4.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.3.4.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.3.4.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.3.3

### Changes
- Unified build scripts: replaced 6 platform-specific shell scripts (PS1/SH) + sign-firefox.js with a single cross-platform Node.js build script (`releases/build.js`)
- Added root `package.json` as the single source of truth for version management
- Added `bump` command to sync version across `package.json`, `extensions/chrome/manifest.json`, and `extensions/firefox/manifest.json` in one step
- Added npm scripts for convenient build commands (`npm run build`, `npm run build:chrome`, `npm run build:firefox:sign`, `npm run bump`)

### Downloads
- [Chrome Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.3/js-eyes-chrome-v1.3.3.zip)
- [Firefox Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.3/js-eyes-firefox-v1.3.3.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.3.3.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.3.3.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.3.2

### Changes
- Refactor code: Rename classes from `KaichiBrowserControl`/`KaichiContentScript` to `BrowserControl`/`ContentScript`
- Improve reconnection mechanism: Add jitter (random offset) to prevent thundering herd problem when multiple clients reconnect simultaneously
- Add `resetReconnectCounter()` method for better connection state management
- Enhanced logging and error messages

### Downloads
- [Chrome Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.2/js-eyes-chrome-v1.3.2.zip)
- [Firefox Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.2/js-eyes-firefox-v1.3.2.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.3.2.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.3.2.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.3.1

### Changes
- Add `get_cookies_by_domain` functionality to enhance cookie retrieval options

### Downloads
- [Chrome Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.1/js-eyes-chrome-v1.3.1.zip)
- [Firefox Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.1/js-eyes-firefox-v1.3.1.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.3.1.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.3.1.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.3.0

### Changes
- Enhanced stability features with rate limiting, request deduplication, and queue management
- Sync Chrome extension with Firefox v1.3.0 stability features
- Integrated utility functions for improved request handling and cleanup tasks

### Downloads
- [Chrome Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.0/js-eyes-chrome-v1.3.0.zip)
- [Firefox Extension](https://github.com/imjszhang/JS-Eyes/releases/download/v1.3.0/js-eyes-firefox-v1.3.0.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.3.0.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.3.0.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.2.0

### Changes
- Updated to version 1.2.0

### Downloads
- [Chrome Extension](js-eyes-chrome-v1.2.0.zip)
- [Firefox Extension](js-eyes-firefox-v1.2.0.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.2.0.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.2.0.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

## v1.1.0

### Changes
- Unified version number to 1.1.0
- Optimized build process, unified output to `dist/` directory
- Firefox extension supports official signing

### Downloads
- [Chrome Extension](js-eyes-chrome-v1.1.0.zip)
- [Firefox Extension](js-eyes-firefox-v1.1.0.xpi)

### Installation Instructions

#### Chrome/Edge
1. Download `js-eyes-chrome-v1.1.0.zip`
2. Extract the ZIP file
3. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the extracted folder

#### Firefox
1. Download `js-eyes-firefox-v1.1.0.xpi`
2. Open Firefox browser
3. Drag and drop the `.xpi` file into the browser window
4. Confirm installation

### What's New
- Improved build and release workflow
- Firefox extension is now officially signed by Mozilla
- All release files are now organized in the `dist/` directory for easier distribution
