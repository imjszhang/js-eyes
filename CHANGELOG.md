# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- **Default Request Timeout**: Default browser-operation request timeout raised from 60 seconds to 1800 seconds (30 minutes) across the protocol, server core, client SDK, plugin config, browser-extension defaults, and all built-in skill clients. Long-running automation flows (captchas, file uploads, slow SPA loads) no longer time out at 60s by default. The per-handler `|| 30000` safety net inside the browser extension is preserved so that lost `init_ack` handshakes still fail fast.

### Added

- **Configurable Server-Side `requestTimeout`**: `createServer()` now honors `options.requestTimeout` (seconds) and falls back to `config.requestTimeout` loaded via `@js-eyes/config`. The value flows into both the `init_ack.serverConfig.request.defaultTimeout` pushed to extensions and the pending-response `setTimeout` on the server. Set it via `plugins.entries["js-eyes"].config.requestTimeout` in `openclaw.json`, or via `js-eyes config set requestTimeout <seconds>` for CLI-launched servers.
- **Multi-Source Skill Discovery (`extraSkillDirs`)**: New plugin config `extraSkillDirs: string[]` lets users mount read-only external skill directories without touching the primary `skillsDir`. Each entry auto-detects as a single skill (contains `skill.contract.js`) or a parent directory (scanned 1 level deep). Primary wins on id conflicts (extras get logged as skipped); extras skip `.integrity.json` checks; `symlink`-to-directory entries are honored. CLI updates: `js-eyes doctor` lists primary + extras with kind/count; `js-eyes skills list` annotates each skill with `Source: primary|extra (<path>)` and ships a structured `--json` output (`primary` / `extras` / `skills[].source` / `skills[].sourcePath` / `conflicts`); `js-eyes skills install` / `approve` reject ids that resolve to an extra source; `js-eyes skills verify` prints `SKIPPED (extra source, no integrity check)` for extras; `enable` / `disable` / `skill run` all search primary → extras. New APIs in `@js-eyes/protocol/skills`: `resolveSkillSources`, `discoverSkillsFromSources`, `readSkillByIdFromSources`, `listSkillDirectories`. See [deployment mode D](./docs/dev/js-eyes-skills/deployment.zh.md#5-部署模式-dprimary--extraskilldirs).

## [2.4.0] - 2026-04-17

> Extension usability release. Adds a Native Messaging host that auto-syncs `server.token` and the HTTP URL into browser extensions, and removes a large amount of legacy authentication / fallback code from the Chrome and Firefox extensions. **No breaking changes for automation clients** — the wire protocol and CLI remain backward compatible.

### Added

- **Native Messaging Token Injection (`apps/native-host`)**: New `js-eyes native-host <install|uninstall|status>` command registers a Native Messaging host for Chrome, Edge, and Firefox on macOS, Linux, and Windows. The host returns `server.token` and `httpUrl` from the local CLI config, so newly installed extensions no longer need manual copy-paste.
- **Popup "Sync Token From Host" Button**: Chrome and Firefox popups expose a primary `sync-token-from-native` button that triggers the Native Messaging round-trip on demand; background scripts also attempt a silent sync on startup.
- **Popup Advanced Fold**: Server address, manual token paste, and Auto Connect are grouped under an `<details>` "Advanced" section so the default surface area is just the connection status and the sync button.
- **`@js-eyes/*` npm Organization (first publish)**: The seven scoped runtime packages — `@js-eyes/protocol`, `@js-eyes/runtime-paths`, `@js-eyes/config`, `@js-eyes/skill-recording`, `@js-eyes/client-sdk`, `@js-eyes/server-core`, `@js-eyes/native-host` — are now published publicly under the [`js-eyes`](https://www.npmjs.com/org/js-eyes) npm organization at version `2.4.0`. Third-party JS Eyes Skills and external Node integrations can `npm install` them directly instead of vendoring from this repo. A new `npm run publish:workspaces` maintainer script (see [packages/devtools/bin/js-eyes-dev.js](packages/devtools/bin/js-eyes-dev.js)) handles topological publishing. The unscoped `js-eyes` CLI keeps its existing vendored-bundle strategy for backward compatibility.

### Changed

- **Default Extension Surface**: The popup no longer shows Preset Addresses, Debug Mode, Connection Mode, Server Type, or the legacy Auth Status line. Help copy references Native Messaging as the default path.
- **Reconnect Recovery**: `background.js` simplifies its reconnect loop now that SSE / HMAC / session timers are gone — `reconnectWithNewSettings` only re-runs discovery and re-opens the WebSocket.

### Removed

- **Deprecated HMAC Auth Path**: The `auth_challenge` / `auth_result` message handlers, `computeHMAC`, `authSecretKey` field, legacy `save_auth_key` / `clear_auth_key` / `get_auth_status` popup messages, and the corresponding "Authentication Key" UI are gone. `init()` also clears the old `auth_secret_key` storage key on upgrade.
- **Session Management Stubs**: `sessionId`, `sessionExpiresAt`, `refreshSession`, `session_expired` / `session_expiring` / `SESSION_EXPIRED` code paths, and timed session refresh logic are removed. Bearer tokens introduced in 2.2.0 are now the sole authentication path.
- **SSE Fallback Code**: The inline `SSEClient` class, `fallbackToSSE`, `scheduleWSRecovery`, `stopSSEFallback`, `connectionMode`, and `sseClient` fields are removed from both extensions. `serverCapabilities` is slimmed down to `{ wsUrl, httpBaseUrl }`.
- **Config Block Cleanup**: `EXTENSION_CONFIG.SSE` and `SECURITY.auth.*` blocks removed from `extensions/chrome/config.js` and `extensions/firefox/config.js`.
- **Dead Popup Settings**: Removed the Debug Mode checkbox and preset-address buttons, related event listeners in `popup.js`, `selectPresetUrl`, `.btn-preset` CSS, and deprecated i18n keys (`presetAddresses`, `preset*`, `debugMode`, `helpConnection2/3/6`, `helpAddress*`, `helpDocker*`, `logPresetSelected`).

### Compatibility

- **Wire Protocol Unchanged**: Existing servers and automation clients keep working. The extension still speaks the same WebSocket frames and honors `security.allowAnonymous`.
- **Upgrade Path**: After installing the 2.4.0 extension, run `npx js-eyes native-host install --browser all` once. Users on restricted environments where Native Messaging is blocked can still paste the token under **Advanced**.
- **Popup Migration**: Storage keys like `auth_secret_key` and `debugMode` are cleared silently on first launch; no user action required.

## [2.3.0] - 2026-04-17

> Security Policy Engine release. Adds a declarative, non-interactive rules layer that sits between tool callers and the browser (task origin + canary taint + egress allowlist + pending-egress). Default `enforcement=soft` → audit + plan-only behavior; existing workflows keep working. See [RELEASE.md](RELEASE.md#230-migration-guide-policy-engine) for the migration guide.

### Added

- **Policy Engine (`packages/client-sdk/policy/`)**: New `PolicyContext` composes `TaskOriginTracker` (L4a same-origin task), `TaintRegistry` (L4b canary + substring), and `EgressGate` (L5 allowlist + pending-egress). `BrowserAutomation.attachPolicy(ctx)` injects the engine into `openUrl`, `executeScript`, `injectCss`, `getCookies`, `getCookiesByDomain`, and `uploadFileToTab`. When no context is attached, all sinks pass through unchanged.
- **Pending Egress Queue**: Non-allowlisted `openUrl` calls write a plan to `~/.js-eyes/runtime/pending-egress/<id>.json` (`0600`) and return `status: 'pending-egress'` instead of executing. CLI: `js-eyes egress list|approve <id>|allow <domain>|clear`.
- **Security Enforcement CLI**: `js-eyes security show` prints the resolved policy; `js-eyes security enforce <off|soft|strict>` writes `security.enforcement` to `config.json`. `off` = audit only; `soft` = plan-only on violation (default); `strict` = hard reject.
- **Server-Side Policy Fallback**: `packages/server-core/ws-handler.js` runs the same rule engine on the WebSocket dispatch path. External automation clients that bypass `client-sdk` still hit the server-side gate. Decisions emit `automation.soft-block` / `automation.pending-egress` / `automation.policy-error` audit events with `task_origin`, `taint_hit`, `egress_matched`, `rule_decision`, and `enforcement` fields.
- **Cookie Canaries**: `getCookies` / `getCookiesByDomain` attach an `__canary: "jse-c-<hex>"` marker to each returned cookie. Any sink tool whose serialized parameters contain a registered cookie value, a cookie canary, or common encoded variants (`encodeURIComponent`, `base64`, `hex`) is soft-blocked as `taint-hit`.
- **HTTP Security Headers**: `packages/server-core/index.js` now sends `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Permissions-Policy: interest-cohort=()` on every HTTP response, closing the `externally_connectable` surface even if a future handler returns HTML.
- **Extension Defensive Guard**: Chrome and Firefox background scripts drop incoming messages whose status/code is `pending-egress`, `POLICY_SOFT_BLOCK`, or `POLICY_PENDING_EGRESS`, ensuring a soft-blocked response cannot be re-interpreted as an instruction.
- **Doctor Policy Report**: `js-eyes doctor` now reports `enforcement` mode, task-origin / taint / egress config, pending-egress backlog count, last `soft-block` timestamp, top-3 blocked tool/rule pairs, and skills whose `runtime.platforms` is empty or `['*']`.

### Changed

- **`DEFAULT_SECURITY_CONFIG`**: Adds `enforcement: 'soft'`, `taskOrigin: { enabled: true, sources: [...] }`, `egressAllowlist: []`, `taint: { enabled: true, mode: 'canary+substring', minValueLength: 6 }`, and `profile: { default: 'full' }`. All new fields default-merge in `packages/config/index.js`; loading a 2.2.x `config.json` produces no errors.
- **Runtime Paths**: `~/.js-eyes/runtime/pending-egress/` is created on first server start or CLI invocation, alongside the existing `pending-consents/` directory.

### Compatibility

- **Default `enforcement=soft`**: Existing agents, skills, and tools keep working. Violating calls are routed to plan-only or pending-egress records, not rejected. Set `JS_EYES_POLICY_ENFORCEMENT=off` or `js-eyes security enforce off` to fall back to audit-only behavior.
- **`skill.contract.runtime.platforms` reused**: A skill whose `platforms` is missing or `['*']` receives the weakest protection (scope defaults to callers' user messages + active tab + fetched links). Skills that already declare explicit platforms automatically opt into strict scope.
- **No Protocol Frame Changes**: WS frames keep the same shape; policy decisions are folded into the existing `*_response` / `error` frames with extra `code`, `rule`, `reasons`, `pendingId` fields. Older extensions that do not understand these fields gracefully fall through (handled at `handleMessage`'s defensive guard).

## [2.2.0] - 2026-04-17

> Security hardening release. Default behavior is now token-authenticated, Origin-checked, loopback-bound, with SHA-256-pinned supply chain and sensitive-tool consent gateway. See [RELEASE.md](RELEASE.md#220-migration-guide-security-hardening) for the full migration guide.

### Added

- **Local Server Authentication**: `packages/server-core` now generates a random bearer token on first start and writes it to `runtime/server.token` (POSIX `0600`, Windows `icacls`). Clients authenticate via `Authorization: Bearer <token>`, `Sec-WebSocket-Protocol: bearer.<token>, js-eyes`, or (loopback-only) `?token=<token>`. CLI: `js-eyes server token [show|init|rotate] [--reveal]`.
- **Origin Allowlist and Loopback Enforcement**: WebSocket upgrades and HTTP requests now require an `Origin` from `security.allowedOrigins` (default covers bundled extensions and loopback). Non-loopback host binds require `security.allowRemoteHost=true`.
- **Structured Audit Log**: New `packages/server-core/audit.js` writes JSONL events (`conn.accept/reject`, `tool.invoke`, `skill.install.plan/apply`, `skill.verify.fail`, `config.change`) to `logs/audit.log` with `0600`. CLI: `js-eyes audit tail`.
- **Sensitive Tool Consent Gateway**: `openclaw-plugin` wraps `execute_script`, `execute_script_action`, `get_cookies`, `get_cookies_by_domain`, `upload_file`, `upload_file_to_tab`, `inject_css`, and `install_skill` through `wrapSensitiveTool`. Policies `allow|confirm|deny` resolve from `security.toolPolicies`; consent decisions are logged to `runtime/pending-consents/<id>.json`. CLI: `js-eyes consent list|approve <id>|deny <id>`.
- **Skill Supply Chain Hardening**:
  - Registry entries now ship with `sha256` and `size`. `docs/skills.json` entries are regenerated by `packages/devtools/lib/builder.js`, with per-zip `.sha256` sidecars.
  - Two-phase installer: `planSkillInstall` stages the bundle and records a plan under `runtime/pending-skills/<skillId>.json`; `applySkillInstall` (via `js-eyes skills approve <id>`) finalizes the install.
  - `packages/protocol/zip-extract.js` replaces `execSync unzip` / `Expand-Archive` with an in-process reader that rejects Zip Slip, symlinks, and oversized entries.
  - `installSkillDependencies` requires `package-lock.json` and runs `npm ci --ignore-scripts --no-audit --no-fund`. Install scripts (`install.sh`/`install.ps1`) mirror the enforcement.
  - `.integrity.json` is written on install. `registerLocalSkills` refuses to load tampered files. CLI: `js-eyes skills verify [id]`.
- **Secure Server Token in Browser Extensions**: Chrome/Firefox popups expose a "Server Token (2.2.0+)" field. The background service worker forwards the token via `Sec-WebSocket-Protocol` and query parameter.
- **Doctor Security Checks**: `js-eyes doctor` now surfaces `allowAnonymous`, host binding, `allowRawEval`, `requireLockfile`, allowed origins, registry URL, key file permissions, and skill integrity status.
- **CLI Commands**: `js-eyes skills install --plan`, `skills approve`, `skills verify`, `server token`, `audit tail`, `consent list|approve|deny`.

### Changed

- **Default Skill State**: `isSkillEnabled` now returns `false` unless explicitly opted in via `skillsEnabled.<id>=true`. Existing skills without an explicit setting after upgrade are left disabled with a warning.
- **Raw Eval Disabled by Default**: Chrome/Firefox `handleExecuteScript*` refuse raw JS payloads unless `security.allowRawEval=true` (host config) or `allowRawEval=true` (extension storage). Rejected calls return `RAW_EVAL_DISABLED`.
- **CORS Tightened**: `Access-Control-Allow-Origin: *` is removed. The server echoes the caller Origin only when it is on the allowlist.
- **HTTP API Minimization**: `/api/browser/tabs`, `/api/browser/clients`, and `/api/browser/config` return `unauthorized` / minimal payloads for unauthenticated callers. `/api/browser/health` remains anonymous-friendly.
- **File Permissions**: `config.json`, `runtime/server.token`, `logs/audit.log`, `runtime/pending-consents/*.json`, and `skills/**/.integrity.json` are created/rewritten with `0600` (best-effort `icacls` on Windows).
- **Extension Manifests**: Chrome `externally_connectable.matches` narrowed to `http://127.0.0.1:18080/*` and `http://localhost:18080/*`; `web_accessible_resources.use_dynamic_url=true`.
- **Version Line**: Monorepo packages, extension manifests, plugin metadata, and extension skill bundles aligned on `2.2.0`.

### Security

- **`allowAnonymous` Compatibility Toggle**: Operators upgrading from 2.1.x can set `security.allowAnonymous=true` to accept unauthenticated WS/HTTP clients during a transition. Every anonymous connection is audited, and `js-eyes doctor` reports the insecure mode.
- **`@main` Fallback URLs Rejected**: Registry and install scripts refuse mutable `@main` / `refs/heads/main` CDN URLs for skill downloads; only tagged/commit-pinned URLs are honored.
- **Consent Gateway Coverage**: Sensitive tools are routed through the consent gateway even when invoked by locally trusted OpenClaw tools, giving a single audit trail for all dangerous actions.

## [2.0.0] - 2026-04-14

> Breaking release that removes child OpenClaw plugin wrappers and makes `js-eyes` the single OpenClaw plugin entrypoint for extension skills.

### Changed

- **Single Plugin Loading Model**: OpenClaw now loads only the main `js-eyes` plugin, which discovers and registers enabled local skills from `skills/` at startup.
- **Skill Host State**: Extension-skill enablement is now owned by JS Eyes runtime config (`skillsEnabled`) instead of relying on child plugin entries inside `openclaw.json`.
- **Install Flow**: `js_eyes_install_skill` and `js-eyes skills install` now install and enable local skills for host-side auto-loading instead of writing child plugin paths into OpenClaw config.
- **Build and Registry Metadata**: Skill packaging and registry generation now read capability metadata directly from `skill.contract.js` and package metadata.
- **Version Line**: Bumped the monorepo, runtime packages, plugin metadata, extension manifests, and child skill packages to `2.0.0`.

### Removed

- **Child OpenClaw Plugin Wrappers**: Removed `skills/*/openclaw-plugin/` wrapper files from extension skills.
- **Legacy Child Plugin Registration Flow**: Removed the old runtime helper that wrote child skill `plugins.load.paths` and `plugins.entries` into `openclaw.json`.

### Fixed

- **Duplicate Tool Registration Handling**: Main plugin skill auto-loading now skips duplicate tool names safely and isolates per-skill registration failures.
- **Legacy Enablement Compatibility**: Existing child-plugin `enabled` state in `openclaw.json` is migrated into JS Eyes host config on first load.

## [1.5.1] - 2026-04-12

### Changed

- **Unified CLI Runtime Home**: Standardized the default `js-eyes` runtime directory to `~/.js-eyes` across macOS, Linux, and Windows.
- **Automatic Legacy Migration**: Added first-run migration from the previous platform-specific runtime directories so existing config, cache, logs, downloads, and PID files keep working.

### Fixed

- **Release Metadata Consistency**: Synced package manifests, docs, site badges, popup version labels, and bundle references to `1.5.1`.

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
