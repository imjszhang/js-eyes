# Release Notes

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
