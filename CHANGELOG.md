# Changelog

All notable changes to this project will be documented in this file.

## [1.5.0] - 2026-04-12

> Publish-oriented monorepo release with npm CLI packaging, unified extension/skill layout, and a cleaned-up build and install flow.

### Added

- **Public npm CLI Package**: Added publishable `js-eyes` CLI under `apps/cli` for local server management, diagnostics, and extension download workflows.
- **Workspace Runtime Packages**: Split runtime code into dedicated workspace packages for protocol, config, runtime paths, client SDK, server core, OpenClaw plugin, and devtools.
- **Generated Skill Bundle Layout**: Build pipeline now stages a self-contained `js-eyes` skill bundle with generated compatibility wrappers and versioned release assets.
- **Extension Skill Registry Flow**: Site build now publishes the skill registry and packaged extension skills using the current `skills/*` workspace layout.
- **CLI Skill Host Flow**: Added `js-eyes skills ...` and `js-eyes skill run ...` commands so the CLI can discover, install, enable, and execute extension skills directly.
- **Shared Skill Contract**: Introduced a reusable skill contract/runtime flow so CLI-hosted skills and OpenClaw skill adapters can share one capability definition.

### Changed

- **Source Repository Layout**: Reorganized the project around `apps/`, `packages/`, `extensions/`, and `skills/` to match the publishable product surfaces.
- **Browser Extension Sources**: Consolidated extension source trees under `extensions/chrome` and `extensions/firefox`.
- **Build and Release Tooling**: Centralized site generation, extension packaging, skill bundle assembly, version bumping, and release helpers in `packages/devtools`.
- **Install Script Sources**: `install.sh` and `install.ps1` now prefer published skill bundle assets from `js-eyes.com`, GitHub Releases, and jsDelivr instead of source archive fallbacks.
- **Version Syncing**: Version bump flow now updates internal `@js-eyes/*` dependency versions alongside package and manifest versions.
- **X Platform Skill Naming**: Unified the X.com extension skill on `js-x-ops-skill` and removed the duplicate `js-search-x` source tree.
- **Skill Installation Pipeline**: Main plugin skill discovery/installation and CLI skill management now reuse the same runtime helpers and installed skill layout.

### Removed

- **Legacy Source Trees**: Removed obsolete root-level runtime directories from the source repository, keeping compatibility paths only in the published skill bundle.
- **Duplicate X Skill Package**: Removed the redundant `skills/js-search-x` implementation and old packaged site artifact.

### Fixed

- **Site Download Links**: Site build now hides extension download buttons when the corresponding release artifacts are unavailable, preventing broken links.
- **Firefox Packaging Guidance**: Updated installation guidance to avoid invalid manual ZIP-to-XPI packaging flows.
- **Server Address Consistency**: Synced documentation, site copy, and extension UI defaults to the current `http://localhost:18080` connection flow.
- **Cross-Extension Copy Consistency**: Aligned Chrome and Firefox popup/help text and skill install examples with the current layout and naming.

## [1.4.0] - 2026-02-24

> Both Firefox and Chrome extensions are now feature-equivalent for multi-server adaptation.

### Added

- **Server Capability Discovery**: Extension now auto-detects server type and capabilities via `/api/browser/config` endpoint before connecting. Supports both lightweight (`js-eyes/server`) and full-featured (`deepseek-cowork`) server backends.
- **Unified Server URL Entry**: Single `SERVER_URL` config replaces separate `WEBSOCKET_SERVER_URL` and `HTTP_SERVER_URL`. WebSocket address is auto-discovered from the HTTP entry point.
- **`DISCOVERY` Config Block**: New configuration section for capability discovery (endpoint, timeout, fallback behavior).
- **Server Type Display**: Popup UI now shows detected server name/version and supported capabilities (SSE, rate limiting, etc.).
- **Adaptive Authentication**: Auth flow is now fully message-driven. The extension reacts to the server's first message (`auth_challenge` or `auth_result`) instead of guessing with a timeout.
- **Tolerant Health Check Parsing**: `HealthChecker` now accepts HTTP 503 as a valid "critical" health response, and supports multiple response formats (`{ status }`, `{ ok }`, or HTTP-status-based inference).

### Changed

- **Init Flow**: Initialization order changed to `loadSettings → discoverServer → initStabilityTools → listeners → connect`, ensuring HTTP base URL is available before health checker and SSE client are created.
- **Auth Timeout**: Replaced the 10-30s auth timeout (which guessed server type) with a 60s safety-net timeout that only fires if the server sends no message at all.
- **`handleAuthResult`**: Now correctly handles lightweight servers that return `auth_result: success` without a `sessionId` — skips session refresh and uses `sendRawMessage` for init.
- **Config Sync**: `syncServerConfig()` first uses cached discovery data before making a separate HTTP request.
- **Reconnect Flow**: `reconnectWithNewSettings()` now re-runs `discoverServer()` and updates health checker / SSE client addresses.
- **Popup Presets**: Preset server addresses updated to HTTP format (`http://localhost:18080`, `http://localhost:3000`).
- **Popup Server Input**: Now accepts `http://`, `https://`, `ws://`, and `wss://` protocols.

### Removed

- **`HTTP_SERVER_URL` Config**: Removed in favor of `SERVER_URL` + auto-discovery.
- **`WEBSOCKET_SERVER_URL` Config**: Removed (single entry merged into `SERVER_URL`).
- **Hardcoded `localhost:3333` Fallbacks**: Eliminated from `HealthChecker` and `SSEClient` constructors.

### Fixed

- **Health Check 503 Handling**: Servers returning HTTP 503 for "critical" status no longer trigger connection failures or circuit breaker false positives.
- **SSE False Activation**: SSE fallback is now conditionally enabled only when the server explicitly supports it, preventing errors against lightweight servers.
- **Port Mismatch Prevention**: Unified URL entry eliminates the class of bugs where HTTP and WS ports are configured inconsistently.

## [1.3.5] - 2026-01-26

### Added

- HMAC-SHA256 authentication support
- Session management with auto-refresh
- Health checker with circuit breaker protection
- SSE fallback for WebSocket failures
- Rate limiting and request deduplication
- Request queue management
- Content Script relay communication mode
- Security configuration (action whitelist, sensitive operation checks)
- Application-level heartbeat (ping/pong)
- Connection instance tracking to prevent orphan connections

## [1.3.3] - Previous

- Initial public release with core browser automation features
