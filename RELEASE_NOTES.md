# Release Notes

## v2.5.2

> Zero-restart security config release. Editing `security.egressAllowlist` (and a small whitelist of related hot-safe fields) in `~/.js-eyes/config/config.json` now takes effect on the running server **without** restarting OpenClaw. Also fixes a long-standing gap where skill tool schemas were invisible to OpenClaw / the LLM. No breaking changes.

### Highlights
- **Security config hot-reload — `egressAllowlist` without restart** _(2026-04-20)_: Editing `security.egressAllowlist` (and a small whitelist of other hot-safe fields) in `~/.js-eyes/config/config.json` now takes effect on the running JS Eyes server **without** restarting OpenClaw. Server-core now ships its own chokidar watcher on the config file (option `hotReloadConfig`, default `true`, with 300 ms debounce and graceful fallback when chokidar is not installed) plus a new `server.reloadSecurity({ source })` handle. A per-connection `PolicyContext` cache was the root cause of the previous "I edited config but `open_url` still returns `pending-egress`" confusion — reloads now bump `state.policyGeneration`, and `getOrCreatePolicyForClient` rebuilds stale per-connection policies from the live `state.security` on the next automation call. Hot-reloadable fields: `egressAllowlist`, `toolPolicies`, `sensitiveCookieDomains`, `allowedOrigins`, `enforcement`. Everything else (e.g. `allowAnonymous`, `allowRemoteBind`, `serverHost`/`serverPort`, token) is recorded under `ignored` in the reload summary and still requires a restart. New built-in tool `js_eyes_reload_security` (agent-driven) and new CLI preview `js-eyes security reload` (read-only dry run). New audit events: `config.hot-reload`, `config.hot-reload.error`, `automation.policy-rebuilt`. `GET /api/browser/status` now exposes `data.policy.generation` and `data.policy.egressAllowlist` for external verification. Affects [packages/server-core/index.js](packages/server-core/index.js), [packages/server-core/ws-handler.js](packages/server-core/ws-handler.js), [packages/config/index.js](packages/config/index.js) (new `resolveHotReloadableSecurity`), [apps/cli/src/cli.js](apps/cli/src/cli.js), and [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs). New tests in [test/security-hot-reload.test.js](test/security-hot-reload.test.js).
- **Skill tool schema is now visible to OpenClaw / LLM** _(2026-04-20)_: `SkillRegistry` used to register per-tool dispatchers with an empty placeholder schema (`{ type: 'object', properties: {} }`) and a generic description, so the LLM could not see `required` / `anyOf` constraints coming from skill contracts (e.g. `mastodon_get_status` silently dropped its `url`/`tabId` parameter and failed at runtime). The dispatcher now carries the contract's real `label` / `description` / `parameters` on first registration. Hot-reloads mutate the dispatcher object in place, so hosts that keep the tool object by reference see schema updates automatically; hosts that snapshot at registration time still get the correct first-load schema, with a one-time OpenClaw restart needed for subsequent schema changes. Affects [packages/protocol/skill-registry.js](packages/protocol/skill-registry.js); new tests in [test/skill-registry.test.js](test/skill-registry.test.js); docs in [docs/dev/js-eyes-skills/deployment.zh.md](docs/dev/js-eyes-skills/deployment.zh.md).

### Migration Notes
- **No breaking changes.** Existing skill contracts work unchanged; they just show up to the LLM with their real schema now.
- After upgrading, a one-time OpenClaw restart is recommended so the first `registerTool` call sees the new code path; subsequent `js-eyes skills link`/`reload` stay zero-restart for same-name tools.
- **Security hot-reload caveats**: (1) When the allowlist flips, live automation connections rebuild their `PolicyContext`, so per-session `js-eyes egress approve <id>` grants are dropped — re-issue on the next `pending-egress`. Static `security.egressAllowlist` entries are picked up automatically. (2) Changing non-hot-reloadable fields (e.g. `allowAnonymous`) prints a warning to the gateway log and still requires a server restart. (3) If `chokidar` is unavailable in the server-core's runtime (rare — it ships with the OpenClaw bundle), the fs-watch path is disabled; use the `js_eyes_reload_security` tool from the agent as an equivalent trigger.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.5.2/js-eyes-chrome-v2.5.2.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.5.2/js-eyes-firefox-v2.5.2.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.5.2/js-eyes-skill-v2.5.2.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.5.2`
2. `js-eyes doctor` — confirm output is unchanged from 2.5.1, and that the new `data.policy.generation` field shows up under the security posture section.

#### OpenClaw
1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.5.2 and run `npm install` in the bundle root so the new `chokidar` usage in server-core resolves.
2. Restart OpenClaw **once** so the updated server-core (config watcher + `reloadSecurity`) and plugin (`js_eyes_reload_security` built-in tool) are loaded. Subsequent edits to `security.egressAllowlist` / `toolPolicies` / `sensitiveCookieDomains` / `allowedOrigins` / `enforcement` take effect within ~300 ms, or immediately via `js_eyes_reload_security`.

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.5.2.zip`, extract, reload unpacked (or update from the Chrome Web Store once live).
2. No popup changes vs 2.5.1 — the **Sync Token From Host** flow keeps working once `native-host install` has been run.

#### Firefox
1. Install `js-eyes-firefox-v2.5.2.xpi` (or update from AMO once the listing is live).

---

## v2.5.1

> Security UX patch release. Fixes the long-standing gap where `security.allowRawEval` on the host was effectively inert because the extension never synced it. No breaking changes.

### Highlights
- **`allowRawEval`: single-toggle from the host** _(2026-04-20)_: The host now pushes `security.allowRawEval` to the browser extension via `init_ack.serverConfig.security.allowRawEval` at WebSocket handshake, and the extension applies it automatically. Previously operators had to flip the value in two places (host config **and** `chrome.storage.local`) because the extension popup never exposed a UI toggle for it — and the host value was never propagated — making the host-side switch effectively a no-op. Now only `security.allowRawEval=true` in `~/.js-eyes/config/config.json` is required; the extension picks it up on the next reconnect. The storage key remains as an explicit opt-out override for security-hardened deployments: `chrome.storage.local.set({allowRawEval:false})` (or `true`) pins the extension regardless of the host. Affects [packages/server-core/ws-handler.js](packages/server-core/ws-handler.js), [extensions/chrome/background/background.js](extensions/chrome/background/background.js), and [extensions/firefox/background/background.js](extensions/firefox/background/background.js).

### Migration Notes
- **No breaking changes.** Wire protocol additive: older extensions ignore the new `serverConfig.security.allowRawEval`; newer extensions still fall back to their previous behavior against older servers.
- After upgrading, restart the js-eyes server and reload the browser extension (`chrome://extensions` → reload). The extension's background console will log `[ConfigSync] allowRawEval synced from host: <value>` on the next handshake.
- If you had previously set `chrome.storage.local.allowRawEval=true` as a workaround, you can clear it with `chrome.storage.local.remove('allowRawEval')` to start following the host again — or leave it as an explicit override.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.5.1/js-eyes-chrome-v2.5.1.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.5.1/js-eyes-firefox-v2.5.1.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.5.1/js-eyes-skill-v2.5.1.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.5.1`
2. `js-eyes doctor` — confirm output is unchanged from 2.5.0.

#### OpenClaw
1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.5.1 and run `npm install` in the bundle root.
2. Restart OpenClaw so the updated server-core (`init_ack` downlink) is loaded.

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.5.1.zip`, extract, reload unpacked (or update from the Chrome Web Store once live).
2. Open `chrome://extensions` → reload the JS Eyes extension. Confirm `[ConfigSync] allowRawEval synced from host: <value>` shows up in the service-worker console after reconnect.

#### Firefox
1. Install `js-eyes-firefox-v2.5.1.xpi` (or update from AMO once the listing is live). Reload the extension so the new background script picks up the sync logic.

---

## v2.5.0

> Extensibility & hot-reload release. Makes JS Eyes Skills a first-class runtime surface: new `SkillRegistry` delivers zero-restart `link` / `unlink` / `reload` semantics on a running OpenClaw plugin, and a new `extraSkillDirs` multi-source layer lets users mount external skill directories without touching the primary `skillsDir`. Wire protocol and CLI contract unchanged.

### Highlights
- **Skill Hot Reload — zero-restart deployment** _(2026-04-19)_: A new `SkillRegistry` (`@js-eyes/protocol/skill-registry`) adds a tool-level dispatcher indirection layer to the OpenClaw plugin. Each tool name is registered once with OpenClaw as a stable closure; hot-loading / hot-unloading skills only updates the internal `toolBindings` map. `js-eyes skills link <path>` / `unlink <path>` / `reload`, plus a chokidar watcher on `~/.js-eyes/config/config.json` (debounced 300 ms), now apply skill changes to the running plugin **without restarting OpenClaw**. Agents can drive the flow via the new `js_eyes_reload_skills` built-in tool, which returns a diff summary (`added` / `removed` / `reloaded` / `toggledOff` / `conflicts` / `failedDispatchers`). Skills can opt into an `async runtime.dispose()` hook (see `examples/js-eyes-skills/js-hello-ops-skill/skill.contract.js`) to release WebSocket connections and timers on hot-unload; `require.cache` under the skill dir is deep-purged (preserving `node_modules`) before the next `require`. Extras discovered for the first time are auto-enabled (primary keeps its "opt-in by default" posture). Fallback: if the host refuses to register a brand-new tool name post-boot, the dispatcher registration failure is surfaced as `failedDispatchers` in the reload summary — a one-time OpenClaw restart is the fix for that narrow case; everything else is 0-restart. Full guide in [deployment.zh.md §5.3](./docs/dev/js-eyes-skills/deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐).
- **Multi-Source Skill Discovery (`extraSkillDirs`)** _(2026-04-19)_: New plugin config `extraSkillDirs: string[]` lets users mount read-only external skill directories without touching the primary `skillsDir`. Each entry auto-detects as a single skill (contains `skill.contract.js`) or a parent directory (scanned 1 level deep); primary wins on id conflicts; extras skip `.integrity.json` checks; `symlink`-to-directory entries are honored. CLI updates: `js-eyes doctor` lists primary + extras with kind/count; `js-eyes skills list` annotates each skill with `Source: primary | extra (<path>)` and ships a structured `--json` output (`primary` / `extras` / `skills[].source` / `skills[].sourcePath` / `conflicts`); `install` / `approve` reject ids that resolve to an extra source; `verify` prints `SKIPPED (extra source, no integrity check)` for extras; `enable` / `disable` / `skill run` all search primary → extras. New APIs in `@js-eyes/protocol/skills`: `resolveSkillSources`, `discoverSkillsFromSources`, `readSkillByIdFromSources`, `listSkillDirectories`. See [deployment mode D](./docs/dev/js-eyes-skills/deployment.zh.md#5-部署模式-dprimary--extraskilldirs).
- **Default request timeout raised to 30 minutes**: The default `requestTimeout` now is 1800 seconds (previously 60). Long automation flows (captchas, slow SPA loads, file uploads) no longer hit a surprise 60s ceiling. The per-handler 30s safety net inside the browser extension is kept as a last-resort guard when the server `init_ack` never arrives.
- **Server-side `requestTimeout` is now truly configurable**: `createServer()` reads `options.requestTimeout` (seconds), falling back to `@js-eyes/config` `config.requestTimeout` and finally to the protocol default. The resolved value is what the server pushes to extensions via `init_ack.serverConfig.request.defaultTimeout` and what the server uses for pending-response timeouts. Set it in `openclaw.json` → `plugins.entries["js-eyes"].config.requestTimeout`, or via `js-eyes config set requestTimeout <seconds>` for the CLI server.
- **Removed vestigial `skills/js-eyes/` parent-skill marker** _(2026-04-19)_: The in-repo `skills/js-eyes/` directory (a single `SKILL.md` with no `skill.contract.js`) has been deleted. Under the v2.0 "single main plugin scans `skillsDir`" model it had zero consumers — the main bundle packer (`SKILL_BUNDLE_FILES` in `packages/devtools/lib/builder.js`) only copies the repo-root `SKILL.md`, `discoverSubSkills()` skips directories without a `skill.contract.js`, and `discoverLocalSkills()` / `discoverSkillsFromSources()` gate on `hasSkillContract()`. The existing test `test/skill-bundle.test.js` → "ignores parent skill docs without a child skill contract" already asserts this directory shape must be skipped, so behavior is unchanged. Alongside the deletion, the soft-semantic `requires.skills: [js-eyes]` frontmatter field (only ever rendered as display text by `js_eyes_discover_skills`, never validated) was removed from `skills/js-x-ops-skill/SKILL.md` and `skills/js-browser-ops-skill/SKILL.md` so the remaining 10 child skills are consistent (the other 8 never declared it). No user-facing or packaging impact; the root `SKILL.md` remains the single source of truth for the `js-eyes` OpenClaw skill definition.

### Migration Notes
- **No breaking changes.** Wire protocol and public CLI surface are unchanged.
- If you were relying on the 60s default `requestTimeout` for fast failure, explicitly set `requestTimeout: 60` in the plugin config (or `js-eyes config set requestTimeout 60`).
- `openclaw-plugin` now depends on `chokidar` (already added to `package.json`). Run `npm install` in the repo root / bundle root after pulling so the new dependency is available before the first plugin load.
- **Upgrading from 2.4.x requires one OpenClaw restart** so the new plugin code — `SkillRegistry` + chokidar watcher — is picked up. After that initial restart, further skill changes (link / unlink / enable / disable / edit / reload) stay zero-restart.
- Nothing to do for custom skills that previously declared `requires.skills: [js-eyes]` in frontmatter — the field was never validated and was removed from the two first-party skills still using it. Leave it or drop it, either is fine.

### Downloads
- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.5.0/js-eyes-chrome-v2.5.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.5.0/js-eyes-firefox-v2.5.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.5.0/js-eyes-skill-v2.5.0.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.5.0`
2. `js-eyes doctor` — confirm `server.token` / policy-engine output is unchanged from 2.4.x.

#### OpenClaw
1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.5.0 and run `npm install` in the bundle root so `chokidar` resolves.
2. Restart OpenClaw **once** so it picks up the new plugin code (`SkillRegistry` + watcher).
3. From now on, `js-eyes skills link <path>` / `unlink <path>` / `enable <id>` / `disable <id>` / `reload`, or the agent-side `js_eyes_reload_skills` tool, all apply without a restart.

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.5.0.zip`, extract, load unpacked (or wait for the Chrome Web Store listing).
2. No popup changes vs 2.4.x — the **Sync Token From Host** flow keeps working once `native-host install` has been run.

#### Firefox
1. Install `js-eyes-firefox-v2.5.0.xpi` (or update from AMO once the public listing is live).

---

## v2.4.0

### Highlights
- **Native Messaging Token Injection**: New `apps/native-host` package and `js-eyes native-host <install|uninstall|status>` command register a Native Messaging host for Chrome, Edge, and Firefox on macOS, Linux, and Windows. The host returns `server.token` + `httpUrl` from the local CLI config so freshly installed extensions no longer need manual copy-paste.
- **Popup "Sync Token From Host" Button**: Chrome and Firefox popups expose a primary `sync-token-from-native` button that triggers the Native Messaging round-trip on demand; background scripts also attempt a silent sync on startup.
- **Streamlined Popup Surface**: The default extension popup now shows only connection status and the sync button. Server address, manual token paste, and Auto Connect are folded under an `<details>` "Advanced" section.
- **Legacy Auth Cleanup**: HMAC `auth_challenge` / `auth_result`, `computeHMAC`, `authSecretKey`, session-refresh timers, and the inline SSE fallback client are removed from both Chrome and Firefox extensions. Bearer tokens (2.2.0+) are now the sole authentication path.
- **`@js-eyes/*` Published to npm**: Seven scoped runtime packages (`@js-eyes/protocol`, `@js-eyes/runtime-paths`, `@js-eyes/config`, `@js-eyes/skill-recording`, `@js-eyes/client-sdk`, `@js-eyes/server-core`, `@js-eyes/native-host`) are now published to the [`js-eyes`](https://www.npmjs.com/org/js-eyes) npm organization at `2.4.0`. Custom JS Eyes Skills and external Node integrations can now `npm install` the pieces they need instead of vendoring from the repo.
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
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
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
