# Changelog

All notable changes to this project will be documented in this file.

## [2.6.2] - 2026-04-24

> **Security hygiene release — zero behavioural changes.** Responds to the
> [ClawHub v2.6.1 Security Scan](https://clawhub.ai/imjszhang/js-eyes) by
> splitting five flagged call sites into dedicated, single-responsibility
> modules (shell exec / env read / file read never co-located with network
> send), adding an opt-in integrity layer for `extraSkillDirs`, and documenting
> the remaining posture trade-offs. Wire protocol, CLI contract, default
> config values, and every public API are byte-for-byte compatible with 2.6.1 —
> upgrading is a drop-in. No CI / signing / SBOM / registry-metadata changes
> in this version; those land in 2.7. See
> [SECURITY_SCAN_NOTES.md](SECURITY_SCAN_NOTES.md).

### Added

- **`packages/protocol/safe-npm.js`** *(2026-04-24)*: New module that wraps the
  only `child_process` call in `@js-eyes/protocol`. `spawnSync('npm', ...)` is
  invoked with `shell: false`, `windowsHide: true`, a whitelisted subcommand
  (`ci` / `install`), constant argv (`--no-audit`, `--no-fund`), and a filtered
  env that drops tokens / OAuth state / arbitrary `process.env` keys before
  reaching npm. `installSkillDependencies` in `packages/protocol/skills.js`
  now delegates to this module.
- **`packages/protocol/openclaw-paths.js`** *(2026-04-24)*: Extracts
  `getOpenClawConfigPath()` — the reader of `OPENCLAW_CONFIG_PATH` /
  `OPENCLAW_STATE_DIR` / `OPENCLAW_HOME` — into its own file so env reads are
  no longer co-located with registry / HTTP code. `skills.js` re-exports the
  symbol, so every external consumer keeps working unchanged.
- **`packages/protocol/fs-io.js`** *(2026-04-24)*: `readJson`, `ensureDir`,
  `safeStat` moved into a network-free module; the invariant is enforced by
  `test/import-boundaries.test.js`.
- **`openclaw-plugin/auth.mjs`** *(2026-04-24)*: Token reading
  (`JS_EYES_SERVER_TOKEN`) and header construction split out of
  `openclaw-plugin/index.mjs`. The new file may never import `ws`, `http`,
  `https`, `net`, or any plugin network helper.
- **`openclaw-plugin/fs-utils/hash.mjs`** *(2026-04-24)*: Streaming
  SHA1 hashing via `createReadStream` + `crypto.createHash`; replaces the
  prior `fs.readFileSync` + buffer path in `_hashFileSync`. Provides both
  async (`hashFileSha1`) and sync (`hashFileSha1Sync`, with a `maxBytes`
  ceiling) variants so existing synchronous callers keep their semantics.
- **`packages/protocol/skill-runner.js`** *(2026-04-24)*: Hosts `runSkillCli`
  — the only remaining `child_process.spawnSync` in `@js-eyes/protocol`
  outside `safe-npm.js`. `argv[0]=process.execPath` (no PATH lookup),
  `shell:false`, `windowsHide:true`; does not import any network helper
  (enforced by `test/import-boundaries.test.js`). `skills.js` re-exports
  `runSkillCli` for backwards compatibility.
- **`packages/protocol/registry-client.js`** *(2026-04-24)*: Hosts
  `fetchSkillsRegistry` and `downloadBuffer`. Keeps all `fetch(…)` calls in
  a single module so they are never co-located with `fs.readFileSync(…)` or
  `fs.createReadStream(…)`. `skills.js` re-exports both symbols.
- **`openclaw-plugin/windows-hide-patch.mjs`** *(2026-04-24)*: Moved the
  Windows-only boot-time patch that defaults `windowsHide:true` on every
  `child_process.spawn` / `execFile` out of `openclaw-plugin/index.mjs`. The
  new module contains the only `child_process` import in the plugin
  (Windows path only; no-op on POSIX); network imports are prohibited.
- **Opt-in integrity snapshots for `extraSkillDirs`** *(2026-04-24)*:
  - New config key `security.verifyExtraSkillDirs` (default `false` — no
    behaviour change on upgrade).
  - New module `packages/protocol/extra-integrity.js` with
    `snapshotExtraDir`, `verifyExtraDir`, `clearSnapshotForExtraDir`, and
    `classifyExtraDir`. Per-file sha256 maps are written to
    `~/.js-eyes/state/extras/<sha1(absPath)>.json` — **outside** the external
    skill directory, so js-eyes never writes into operator-owned trees.
  - `js-eyes skills link <abs-path>` auto-snapshots when verification is
    enabled; new `js-eyes skills relink <abs-path>` re-snapshots after a
    reviewed edit; `js-eyes skills unlink` clears the snapshot.
  - `SkillRegistry` refuses to load an `extra` skill whose snapshot drifted,
    with a gateway-log pointer to `js-eyes skills relink`.
- **`js-eyes doctor --json`** *(2026-04-24)*: New flag returns the full
  security posture (version, token presence + source, security config,
  loopback status, skill integrity map, policy snapshot) as a single JSON
  document for auditors / CI pipelines. Text output is byte-identical to
  2.6.1. Each extra skill row also carries an
  `integrity: verified | drifted | missing-snapshot | off | error` tag.
- **Local launcher scripts for native-host install** *(2026-04-24)*:
  `bin/js-eyes-native-host-install.sh` (macOS/Linux) and
  `bin/js-eyes-native-host-install.ps1` (Windows) forward to
  `node apps/cli/bin/js-eyes.js native-host install` — zero network, zero
  `npx` dependency. `SKILL.md` and `docs/native-messaging.md` now recommend
  the local launcher as the preferred path; `npx` remains a documented
  fallback.
- **`SECURITY_SCAN_NOTES.md`** *(2026-04-24)*: New top-level document that
  responds to each of the 5 static-analysis findings and 6 OpenClaw narrative
  concerns from the ClawHub scan, with pointers to the modules / config keys
  that mitigate them.
- **`README.md` Security Posture table** *(2026-04-24)*: Compact matrix of
  risk item / current default / how to tighten / config switch / verify
  command, linked to the relevant `SECURITY_SCAN_NOTES.md` section.
- **`SKILL.md` Safe Default Mode section** *(2026-04-24)*: Informational
  section documenting the capability envelope when `allowRawEval=false`
  (click / type / open_url / screenshot / xpath / declarative
  `execute_action` all still work; only the `execute_script*` family is
  refused with `RAW_EVAL_DISABLED`). The existing Setup Workflow is
  unchanged — Safe Default Mode is purely additive guidance.

### Tests

- `test/import-boundaries.test.js`: AST-level assertion that
  `fs-io.js`, `openclaw-paths.js`, `safe-npm.js`, `skill-runner.js`,
  `auth.mjs`, `fs-utils/hash.mjs`, and `windows-hide-patch.mjs` never import
  `ws` / `http` / `https` / `net` (or their `node:*` equivalents) and never
  call `fetch` / `new WebSocket()`.
- `scripts/scan-clawhub-patterns.js` + `npm run scan:security`:
  self-contained reproduction of ClawHub's static-analysis heuristic over
  `packages/protocol/` and `openclaw-plugin/`. Reports three expected
  residuals (all allowlisted and documented in `SECURITY_SCAN_NOTES.md`) and
  exits non-zero on any new unexpected finding.
- `test/safe-npm.test.js`: subcommand whitelist, argv immutability,
  `shell:false`, env filtering.
- `test/extra-integrity.test.js`: snapshot → unchanged → drift (modified /
  deleted / added file) → relink recovery; snapshot path derivation; clear.
- `test/doctor-json.test.js`: `doctor --json` schema contract, including
  the new `security.verifyExtraSkillDirs` row.

### Fixed

- **CLI 子进程长尾 — 一次性查询命令跑完不退出** _(2026-04-25)_: `openclaw js-eyes status` / `openclaw js-eyes tabs` / `openclaw js-eyes server stop` 这类一次性 CLI 命令在子进程跑完业务后会挂着 ~50–100 MB 不退出，根因是 `register()` 入口启动的 chokidar `configWatcher` + `skillDirWatcher` 和 `skillRegistry.init()` 持有 inotify/FSEvents handle 钉住 event loop，OpenClaw runtime 等不到 event loop 自然清空 → 子进程长尾。修复方式：在 [`openclaw-plugin/index.mjs`](openclaw-plugin/index.mjs) 模块顶层新增 `async exitCli(success)` helper，先 `await currentRegistration.teardown({})` 关掉 chokidar / skillRegistry / WS bot，再 `setTimeout(() => process.exit(...), 100).unref()` 兜底强退；三个一次性 CLI handler（`status` / `tabs` / `server stop`）末尾按成功/失败分别调 `await exitCli(true/false)`。同时新增 `installCliExitHandlers()` 注册 `uncaughtException` / `unhandledRejection` 全局兜底（仅在 `api.registerCli` 回调里调用一次，不污染 Gateway 进程），与 [js-moltbook 那次同模式](https://github.com/imjszhang/js-moltbook) 实战验证过的 helper 一致。**严格保持 `serverCmd.command("start")` 不动** — 它是预期永不退出的 daemon，靠 `await server.start()` 后开放端口钉住 event loop。`registerService` / `registerTool` / `currentRegistration` / `teardownRegistration` / chokidar 整体设计、`_lastHashByPath` Map 全部原样。实测：CLI 退出时间从"长尾几十秒至分钟级"降到 ~2.6s（其中 ~2.5s 是 plugin 冷启 skill 加载），日志可见 `[js-eyes] Service stopped` 确认 teardown 触发。Files: [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs).

### Compatibility

- **Zero behavioural change**: every default is identical to 2.6.1. The
  `security.verifyExtraSkillDirs` switch defaults to `false`, so existing
  `extraSkillDirs` users see no difference until they opt in.
- **Wire Protocol Unchanged**: servers, clients, browser extensions, and
  automation keep working against 2.6.x.
- **API Preservation**: `getOpenClawConfigPath`, `readJson`, `ensureDir`,
  `installSkillDependencies`, `getServerToken`, and `getLocalRequestHeaders`
  retain their external signatures and module paths (the `skills.js` /
  `index.mjs` re-exports are preserved).
- **Upgrade Path**: `js-eyes skills update js-eyes` (or reinstall the bundle)
  is enough. No config migration, no restart semantics beyond the usual
  plugin-module rule — skill-level edits remain zero-restart.

## [2.6.1] - 2026-04-24

> Memory-leak bugfix release for the long-running OpenClaw host (`ai.openclaw.gateway`). Fixes listener / fd / resource accumulation caused by hot-reload and repeated plugin registration. **No breaking changes** — wire protocol, CLI contract, and all public APIs are unchanged.

### Fixed

- **`MaxListenersExceededWarning` + `process.on('exit')` listener leak in the long-running host** _(2026-04-24)_: Every `new BrowserAutomation(...)` used to attach its own `SIGINT` / `SIGTERM` / `exit` listeners, so after enough skill hot-reloads the gateway tripped Node's default `maxListeners` and slowly grew native handles. `BrowserAutomation` now keeps a module-level `Set` of active instances and installs a **single** set of process hooks via `_installProcessHooksOnce()`; `disconnect()` only removes the instance from the set. The same fix was replicated to all 7 `skills/*/lib/js-eyes-client.js` copies. `skills/js-x-ops-skill/lib/xUtils.js` also guarded its own `process.on('exit')` with a `Symbol.for('js-eyes.skills.x-ops.xUtils.exitHook.v1')` flag on `process` itself, so re-`require`s after a `require.cache` purge no longer stack duplicate exit callbacks. Files: [packages/client-sdk/index.js](packages/client-sdk/index.js), [skills/*/lib/js-eyes-client.js](skills), [skills/js-x-ops-skill/lib/xUtils.js](skills/js-x-ops-skill/lib/xUtils.js).
- **Idempotent `openclaw-plugin#register()` — no more duplicated watchers / servers / skill registries** _(2026-04-24)_: When the OpenClaw host re-invoked `register()` (e.g. after a skill toggle or config edit) the plugin silently rebuilt a fresh `SkillRegistry`, `chokidar` watchers, WebSocket server, and `BrowserAutomation`, while the old ones kept running — port bind races, leaked fds, and phantom reload storms followed. `register()` is now `async` and guards a module-level `currentRegistration` singleton: on re-entry it `await`s a deterministic `teardownRegistration(ctx)` (`reloadTimer → configWatcher → skillDirWatcher → skillRegistry.disposeAll() → bot.disconnect() → server.stop()`) before wiring the new instance. `registerService({ id: "js-eyes-server" }).stop()` routes through the same teardown and only nulls the singleton when its `api` identity matches, so a late stop from an old registration can't clobber the new one. Files: [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs).
- **Skill hot-reload now disposes adapters and detects real content changes** _(2026-04-24)_: `SkillRegistry._reloadCore` previously decided "changed vs. unchanged" from `sourcePath`/`skillDir` only, so edits to `skill.contract.js` that kept the same path were ignored and old adapters (with live WebSockets + intervals) piled up in memory. A new `computeSkillFingerprint(skillDir)` (mtime + size of `skill.contract.js` and `package.json`) is stored on the skill state and compared on every reload; the contract-level `runtime.dispose()` is now called before the old module is evicted from `require.cache`, with a warn-level invariant assertion and a `Purged N cached module(s)` info log when purge actually runs. Every skill that opens a `BrowserAutomation` (`js-browser-ops`, `js-jike-ops`, `js-reddit-ops`, `js-wechat-ops`, `js-x-ops`, `js-xiaohongshu-ops`, `js-zhihu-ops`) gained a `dispose()` that drains the bot and nulls the handle. Files: [packages/protocol/skill-registry.js](packages/protocol/skill-registry.js), [skills/*/skill.contract.js](skills).
- **Chokidar noise no longer triggers phantom reloads** _(2026-04-24)_: Editor atomic-writes, `.DS_Store` churn, and swap files on macOS used to fire `config-watch` / `skills-dir-watch` events that cascaded into full `SkillRegistry.reload()` calls. The plugin now ignores `.DS_Store`, `.git/`, `*.swp|swo|swx`, and `*~` at the watcher layer, and layers a sha1 content-hash gate (`scheduleReloadIfChanged(reason, filePath)`) so reloads only fire when the watched file's bytes actually changed. `runDiscover` also deduplicates `invalidExtraSkillDir` / skill-conflict warnings via per-registry `Set`s to stop log spam on repeated reloads. Files: [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs), [packages/protocol/skill-registry.js](packages/protocol/skill-registry.js).

### Compatibility

- **Wire Protocol Unchanged**: Servers, clients, browser extensions, and automation keep working against 2.6.0. No public API, CLI, or config surface changed.
- **Sub-skill versions**: Skills that gained a `dispose()` bumped patch-wise — `js-browser-ops` `2.1.0 → 2.1.1`, and `js-jike-ops` / `js-reddit-ops` / `js-wechat-ops` / `js-x-ops` / `js-xiaohongshu-ops` / `js-zhihu-ops` `2.0.0 → 2.0.1`. `js-bilibili-ops` and `js-youtube-ops` are untouched and retain `2.0.0`. Per the 2.6.0 decoupling, these sub-skill patches are independent of the parent bump.
- **Upgrade Path**: Reinstall the parent `js-eyes` skill (or run `js-eyes skills update --all`) to pick up `2.6.1`. Existing long-running hosts should restart the gateway process once after upgrading so the freshly-imported plugin module installs the single-shot `process.on` hooks.

### Tests

- Full suite: **225/225 passing** (no new failures). Existing `skill-registry.test.js` / `skill-registry.integration.test.js` already cover the dispose-before-purge ordering and the hot-reload fingerprint path.

## [2.6.0] - 2026-04-21

> Sub-skill independent upgrade release. Sub-skills under `skills/*` now ship their own version channel — users on an older parent `js-eyes` skill can pull just the sub-skills they care about without reinstalling the whole bundle. **No breaking changes** — wire protocol, CLI contract, and existing `install.sh` flows are all backward compatible; the new `minParentVersion` gate is forward-looking and only activates when a future sub-skill declares a floor.

### Added

- **Sub-skill independent upgrade channel** _(2026-04-21)_: Sub-skills under `skills/*` can now be upgraded without re-installing the parent `js-eyes` skill.
  - New CLI command `js-eyes skills update <skillId|--all> [--dry-run] [--allow-postinstall]` that reuses the existing `planSkillInstall` / `applySkillInstall` pipeline, preserves the user's `skillsEnabled.<id>` state, and refuses to cross a `minParentVersion` gap (exit code `2`). The gate compares the registry entry's `minParentVersion` against the **client's** installed parent version (read from `apps/cli/package.json#version`), not the registry snapshot's `parentSkill.version`.
  - `js-eyes skills list` now reports `Update available: <local> -> <registry> (run: js-eyes skills update <id>)` and surfaces `updateAvailable` / `latestVersion` in the `--json` payload.
  - `install.sh` (and `docs/install.sh`) compare the local sub-skill's `package.json` version against the registry, report `up to date` when they match, and upgrade in place (no `Overwrite?` prompt) when the registry is newer. `JS_EYES_SKILL=all bash` iterates every installed primary-source sub-skill. The shell path mirrors the CLI's `minParentVersion` gate, reading the local parent version from `${JS_EYES_ROOT}/package.json`.
  - `docs/skills.json` entries gain `minParentVersion`, `releasedAt`, and `changelogUrl` fields so clients can enforce parent-version gates and surface release metadata. Sub-skills can declare their parent floor via `package.json#jsEyes.minParentVersion` or `peerDependencies["js-eyes"]`; missing declarations fall back to the current parent version for backward compatibility. `releasedAt` uses the latest git commit time for the sub-skill directory; `changelogUrl` points to the sub-skill's `CHANGELOG.md` on GitHub when present.
  - Registry `sha256` integrity is still enforced on every update, and installs are atomic (staging directory → rename) so a failed upgrade never leaves a half-installed skill behind.
  - Tests: new `test/skill-update.test.js` covers happy path, already-up-to-date, `minParentVersion` block, `--dry-run`, and the `skills list` update hint via a mock HTTP registry. Full suite: 225/225 passing.

### Compatibility

- **Wire Protocol Unchanged**: Servers, clients, browser extensions, and automation keep working against 2.5.x. The new registry fields are additive and optional — old clients parsing `docs/skills.json` ignore them safely.
- **Upgrade Path**: Upgrade the parent `js-eyes` skill to 2.6.0 (normal install) to pick up `skills update`. Existing `js-eyes skills install/approve/uninstall` flows are unchanged. Sub-skill versions in `skills/*/package.json` are **intentionally not synced** by `js-eyes-dev bump` — the independent upgrade channel relies on that decoupling.
- **`minParentVersion` semantics**: Shipping `2.6.0` is what makes this gate usable. Future sub-skill releases can set `minParentVersion: "2.6.0"` (or higher) to ensure old parents get a clear `BLOCKED (requires parent js-eyes >= ...)` message instead of a broken install. Sub-skills that don't declare a floor continue to install on any parent the registry still advertises.

## [2.5.2] - 2026-04-21

> Zero-restart security config release. `security.egressAllowlist` and a small whitelist of related fields are now hot-reloadable without restarting OpenClaw or the server, and skill tool schemas are finally visible to OpenClaw / LLM. **No breaking changes** — wire protocol and public APIs remain backward compatible.

### Added

- **Security config hot-reload — `egressAllowlist` without restart** _(2026-04-20)_: Editing `security.egressAllowlist` (and a small whitelist of other hot-safe fields) in `~/.js-eyes/config/config.json` now takes effect on the running JS Eyes server **without** restarting OpenClaw. Server-core ships its own chokidar watcher on the config file (option `hotReloadConfig`, default `true`, with 300 ms debounce and graceful fallback when chokidar is not installed) plus a new `server.reloadSecurity({ source })` handle. A per-connection `PolicyContext` cache was the root cause of the previous "I edited config but `open_url` still returns `pending-egress`" confusion — reloads now bump `state.policyGeneration`, and `getOrCreatePolicyForClient` rebuilds stale per-connection policies from the live `state.security` on the next automation call. Hot-reloadable fields: `egressAllowlist`, `toolPolicies`, `sensitiveCookieDomains`, `allowedOrigins`, `enforcement`. Everything else (e.g. `allowAnonymous`, `allowRemoteBind`, `serverHost`/`serverPort`, token) is recorded under `ignored` in the reload summary and still requires a restart. New built-in tool `js_eyes_reload_security` (agent-driven) and new CLI preview `js-eyes security reload` (read-only dry run). New audit events: `config.hot-reload`, `config.hot-reload.error`, `automation.policy-rebuilt`. `GET /api/browser/status` now exposes `data.policy.generation` and `data.policy.egressAllowlist` for external verification. Files: [packages/server-core/index.js](packages/server-core/index.js), [packages/server-core/ws-handler.js](packages/server-core/ws-handler.js), [packages/config/index.js](packages/config/index.js) (new `resolveHotReloadableSecurity`), [apps/cli/src/cli.js](apps/cli/src/cli.js), [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs). New tests in [test/security-hot-reload.test.js](test/security-hot-reload.test.js).

### Fixed

- **Skill tool schema is now visible to OpenClaw / LLM** _(2026-04-20)_: `SkillRegistry`'s per-tool dispatcher was previously registered with a placeholder `{ type: 'object', properties: {} }` schema and a generic `[js-eyes dispatcher] <name>` description, so OpenClaw (and the LLM behind it) never saw the real `label`/`description`/`parameters` (including `required` / `anyOf`) declared by the skill contract. This made models silently omit required arguments, e.g. `mastodon_get_status` being invoked without `url` or `tabId` and failing at runtime with `必须提供 url 或 tabId 其中之一`. The dispatcher now carries the contract's real metadata on first registration, and hot-reloads mutate the dispatcher object in place (by reference) so schema updates propagate to hosts that retain the tool object by reference; a one-time OpenClaw restart is still suggested for hosts that snapshot tool metadata at registration time. Files: [packages/protocol/skill-registry.js](packages/protocol/skill-registry.js), [test/skill-registry.test.js](test/skill-registry.test.js), [docs/dev/js-eyes-skills/deployment.zh.md](docs/dev/js-eyes-skills/deployment.zh.md).

### Compatibility

- **Wire Protocol Unchanged**: Servers, clients, and automation keep working against 2.5.2. Existing skill contracts work unchanged and now show up to the LLM with their real schema.
- **Upgrade Path**:
  - After upgrading, a one-time OpenClaw restart is recommended so the first `registerTool` call sees the new dispatcher-schema code path; subsequent `js-eyes skills link`/`reload` stay zero-restart for same-name tools.
  - **Security hot-reload caveats**: (1) When the allowlist flips, live automation connections rebuild their `PolicyContext`, so per-session `js-eyes egress approve <id>` grants are dropped — re-issue on the next `pending-egress`. Static `security.egressAllowlist` entries are picked up automatically. (2) Changing non-hot-reloadable fields (e.g. `allowAnonymous`) prints a warning to the gateway log and still requires a server restart. (3) If `chokidar` is unavailable in the server-core runtime (rare — it ships with the OpenClaw bundle), the fs-watch path is disabled; use the `js_eyes_reload_security` tool from the agent as an equivalent trigger.

## [2.5.1] - 2026-04-20

> Security UX patch release. Fixes a long-standing gap where the host's `security.allowRawEval` flag was effectively inert because the extension never synced it. No breaking changes.

### Changed
- **`allowRawEval`: single-toggle from the host** _(2026-04-20)_: Before v2.5.1, enabling raw `execute_script` required flipping `security.allowRawEval=true` on the host **and** manually seeding `chrome.storage.local.allowRawEval=true` on the extension (no popup UI was ever exposed for it), so the host-side toggle was effectively a no-op in practice. The host now pushes `security.allowRawEval` to the extension via `init_ack.serverConfig.security.allowRawEval` at WebSocket handshake; the extension applies the value automatically. The `chrome.storage.local` / `browser.storage.local` key is preserved as an explicit **opt-out override** (set it to `true` or `false` to pin the extension regardless of the host). Everyday users only need to touch `~/.js-eyes/config/config.json`. Files: [packages/server-core/ws-handler.js](packages/server-core/ws-handler.js), [extensions/chrome/background/background.js](extensions/chrome/background/background.js), [extensions/firefox/background/background.js](extensions/firefox/background/background.js).

### Compatibility
- **Wire Protocol Extended, Backward Compatible**: `init_ack.serverConfig` gains a new optional `security.allowRawEval` field. Older extensions simply ignore it; newer extensions connected to older servers fall back to their previous behavior (storage key or default `false`).
- **Upgrade Path**: Restart the js-eyes server, then reload the browser extension (`chrome://extensions` → reload) so the new background script picks up the sync logic. The extension will log `[ConfigSync] allowRawEval synced from host: <value>` on the next handshake.

## [2.5.0] - 2026-04-19

> Extensibility & hot-reload release. Promotes JS Eyes Skills to a first-class runtime surface with zero-restart `link` / `unlink` / `reload` semantics, multi-source discovery via `extraSkillDirs`, and a 30-minute default request timeout. **No breaking changes** — wire protocol, CLI contract, and public APIs are all backward compatible.

### Changed

- **Default Request Timeout**: Default browser-operation request timeout raised from 60 seconds to 1800 seconds (30 minutes) across the protocol, server core, client SDK, plugin config, browser-extension defaults, and all built-in skill clients. Long-running automation flows (captchas, file uploads, slow SPA loads) no longer time out at 60s by default. The per-handler `|| 30000` safety net inside the browser extension is preserved so that lost `init_ack` handshakes still fail fast.

### Added

- **Skill Hot Reload (zero-restart deployment)** _(2026-04-19)_: New `SkillRegistry` abstraction in `@js-eyes/protocol/skill-registry` with a **tool-level dispatcher indirection** layer. Each tool name is registered once with OpenClaw (as a stable dispatcher closure); hot-loading and unloading skills only updates the internal `toolBindings` map, so `js-eyes skills link <path>` + writes to `~/.js-eyes/config/config.json` now take effect without restarting OpenClaw. A chokidar watcher on the host config file + optional dev-mode watcher on skill directories trigger a 300ms debounced `registry.reload()`; a new `js_eyes_reload_skills` built-in tool returns the diff summary (`added` / `removed` / `reloaded` / `toggledOff` / `conflicts` / `failedDispatchers`) so Agents can drive the flow. Extras discovered for the first time are auto-enabled (primary keeps its "opt-in by default" posture). Skills can opt into a `runtime.dispose()` hook to release WebSocket connections and timers on hot-unload (`require.cache` entries under the skill dir are deep-purged, preserving `node_modules`). New CLI commands: `js-eyes skills link <path>` / `unlink <path>` / `reload` (touches the config file to trigger the watcher). Fallback: if the host refuses to register a brand-new tool name post-boot, the dispatcher registration failure is logged and a one-time OpenClaw restart is suggested — all other variations remain 0-restart. Full docs in [deployment.zh.md §5.3](./docs/dev/js-eyes-skills/deployment.zh.md#53-零重启部署skills-linkunlinkreload推荐).
- **Configurable Server-Side `requestTimeout`**: `createServer()` now honors `options.requestTimeout` (seconds) and falls back to `config.requestTimeout` loaded via `@js-eyes/config`. The value flows into both the `init_ack.serverConfig.request.defaultTimeout` pushed to extensions and the pending-response `setTimeout` on the server. Set it via `plugins.entries["js-eyes"].config.requestTimeout` in `openclaw.json`, or via `js-eyes config set requestTimeout <seconds>` for CLI-launched servers.
- **Multi-Source Skill Discovery (`extraSkillDirs`)**: New plugin config `extraSkillDirs: string[]` lets users mount read-only external skill directories without touching the primary `skillsDir`. Each entry auto-detects as a single skill (contains `skill.contract.js`) or a parent directory (scanned 1 level deep). Primary wins on id conflicts (extras get logged as skipped); extras skip `.integrity.json` checks; `symlink`-to-directory entries are honored. CLI updates: `js-eyes doctor` lists primary + extras with kind/count; `js-eyes skills list` annotates each skill with `Source: primary|extra (<path>)` and ships a structured `--json` output (`primary` / `extras` / `skills[].source` / `skills[].sourcePath` / `conflicts`); `js-eyes skills install` / `approve` reject ids that resolve to an extra source; `js-eyes skills verify` prints `SKIPPED (extra source, no integrity check)` for extras; `enable` / `disable` / `skill run` all search primary → extras. New APIs in `@js-eyes/protocol/skills`: `resolveSkillSources`, `discoverSkillsFromSources`, `readSkillByIdFromSources`, `listSkillDirectories`. See [deployment mode D](./docs/dev/js-eyes-skills/deployment.zh.md#5-部署模式-dprimary--extraskilldirs).
- **Plugin config schema: `extraSkillDirs` / `watchConfig` / `devWatchSkills`**: `openclaw-plugin/openclaw.plugin.json` now declares these three new plugin config keys in `configSchema.properties` with matching `uiHints`, so OpenClaw's strict-schema validation (`additionalProperties: false`) and config UI pick them up correctly.
- **Authoring a new skill — canonical entry point in the root `SKILL.md`**: The OpenClaw-facing `SKILL.md` now carries an `Authoring A New Extension Skill` section plus a `Skill Lifecycle Cheat Sheet` covering `list / install / approve / verify / enable / disable / link / unlink / reload` per intent, making self-serve extension-skill authoring a first-class workflow for host agents.

### Removed

- **Vestigial `skills/js-eyes/` parent-skill marker**: The in-repo `skills/js-eyes/` directory (a single `SKILL.md` without a `skill.contract.js`) has been deleted. Under the v2.0 single-main-plugin model it had zero consumers — `SKILL_BUNDLE_FILES` in `packages/devtools/lib/builder.js` only copies the repo-root `SKILL.md`; `discoverSubSkills()` / `discoverLocalSkills()` / `discoverSkillsFromSources()` all gate on `hasSkillContract()` and skip this directory; the existing `test/skill-bundle.test.js` → "ignores parent skill docs without a child skill contract" test already asserts that behavior. The soft-semantic `requires.skills: [js-eyes]` frontmatter field — only ever rendered as display text by `js_eyes_discover_skills`, never validated — was removed from `skills/js-x-ops-skill/SKILL.md` and `skills/js-browser-ops-skill/SKILL.md` so the 10 remaining child skills are consistent.

### Compatibility

- **Wire Protocol Unchanged**: Servers, clients, and automation keep working against 2.5.0.
- **Upgrade Path**: `npm install` in the repo/bundle root to pull the new `chokidar` dependency, then restart OpenClaw **once** so the new plugin code — `SkillRegistry` + watcher — is loaded. From that point on every skill change (link / unlink / enable / disable / edit / reload) is zero-restart.

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
