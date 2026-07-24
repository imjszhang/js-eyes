# Changelog

All notable changes to this project will be documented in this file.

## [2.8.5] - 2026-07-22

> **Native MCP facade release.** Standard MCP hosts can now use the existing JS
> Eyes browser runtime directly through a safe-by-default stdio adapter.

### Added

- New public `@js-eyes/mcp-server` package with a host-neutral stdio MCP
  implementation, CLI configuration, lazy BrowserAutomation lifecycle, and
  structured diagnostics.
- Eight-tool `safe` profile plus an explicit thirteen-tool `full` profile for
  JavaScript, CSS, cookies, and file uploads.
- Deterministic multi-browser target resolution, native MCP screenshot image
  blocks, stable/redacted error payloads, bounded HTML output, and stderr-only
  diagnostics.
- Official MCP client conformance tests for in-memory and stdio transports,
  plus an end-to-end MCP → Client SDK → Server Core → extension test.
- MCP architecture decision record, host configuration guide, package README,
  and nine-package release integration.

### Changed

- Client SDK connection timeout is now configurable for bounded MCP status and
  lazy-connect operations.
- Release verification, package smoke tests, documentation, and controlled npm
  publishing now include `@js-eyes/mcp-server`.

### Security

- Sensitive MCP operations are absent from discovery in the default profile.
- Unknown upstream errors are converted to stable generic errors to avoid
  leaking authentication tokens or browser payloads.
- The published MCP package has no official SDK runtime dependency and passes
  an isolated production dependency audit with zero known vulnerabilities.

## [2.8.4] - 2026-07-19

> **Browser compatibility fixes, reproducible release gates, and hotspot
> refactoring.** Platform/core package versions, extension manifests, and the
> OpenClaw plugin are synchronized to `2.8.4`; bundled sub-skills retain their
> independent versions.

### Added

- Chrome MV3 `userScripts` execution path for approved arbitrary JavaScript,
  with explicit availability errors and Promise-result support.
- WebSocket handshake coverage for both `jse-token.<token>` SDK clients and
  `bearer.<token>` browser-extension clients.
- Repository-wide lint, typecheck, coverage, package-smoke, extension-sync, and
  controlled release workflows.
- Contributor automation, Dependabot configuration, ownership-oriented tests,
  and modular boundary checks.
- `js-x-ops-skill@3.8.5` media download/upload, Article/DraftJS processing,
  official API routing and retry improvements, promoted-content detection, and
  expanded tests.

### Changed

- Split CLI commands, OpenClaw registration, devtools build responsibilities,
  browser background orchestration, and X skill post/API hotspots into bounded
  modules.
- Consolidated browser-neutral extension behavior under `extensions/shared`
  with generated-copy consistency checks.
- Browser tokens are carried in the WebSocket subprotocol and are no longer
  duplicated into connection URLs.
- Normal local builds are unsigned; signing and external publication are
  isolated behind the protected release workflow.

### Fixed

- Chrome handshake failures caused by the server not echoing the extension's
  requested `bearer.<token>` subprotocol.
- Chrome `execute_script` returning `null` under Manifest V3 CSP.
- Firefox background startup failures caused by classic-script scope
  collisions after module extraction.
- Unchecked Chrome popup `runtime.lastError` noise when an extension reload
  temporarily removes the message receiver.

## [2.8.3] - 2026-06-26

> **Site pipeline + bundled HN skill + sub-skill feature drops.** Platform/core
> package versions, extension manifests, and OpenClaw plugin manifests were
> bumped to `2.8.3`. Sub-skills under `skills/` keep independent version numbers.

### Added

- **GitHub Pages CI**: `.github/workflows/pages.yml` builds `src/` → `dist/` on
  every push to `main` and deploys via GitHub Actions (`npm run build:site`).
- **Local server launchers**: `bin/js-eyes-server-start.sh` / `.cmd` start the
  repo-local CLI without touching the npm registry.
- **Bundled `js-hn-ops-skill@1.0.0`**: Hacker News read-only + browser navigation
  (Firebase API + Algolia + DOM fallback). Enabled by default in the stock
  `skillsEnabled` host config.
- **`js-x-ops-skill@3.5.0`** (independent sub-skill version):
  - Official X API v2 channel (`node index.js api …`, `--via auto|api` on write
    paths) with `status` / `timeline` / `tweets` / `mentions` / `trends` /
    `delete` / write subcommands.
  - GraphQL bridge: pinned-tweet marking, profile enrichment, `budgetMs` on
    `x_get_post`, standalone `trends` CLI.
- **`js-browser-ops-skill@2.5.1`**: `autoAllowDomain` on `browser_read_page`
  (default `true`) auto-adds new hosts to `egressAllowlist`; CLI
  `--allow-new-domain` / `--no-auto-allow-domain`; clearer `ServerPolicyError`
  feedback on policy blocks.

### Changed

- **Site source layout**: marketing site source lives under `src/`; release
  artifacts (`skills.json`, skill zips, install scripts) are generated into
  `dist/` by `npm run build:site`. Developer markdown stays under `docs/`.
- **`docs/dev/js-eyes-skills/`** restored as the authoring/deployment guide tree;
  registry references now point at `dist/skills.json` (built artifact) instead
  of a committed copy under `docs/`.
- **`npm run bump`** skips `@js-eyes/visual-bridge-kit` and
  `@js-eyes/visual-replay-hyperframes` — they remain on independent semver
  (`0.6.x` / `0.7.x`).

### Fixed

- `openclaw-plugin`: silence duplicate register warning during cli-metadata
  handoff.
- `packages/devtools/lib/dotenv.js`: map `npm_token` → `NPM_TOKEN` for publish
  workflows.

## [2.8.2] - 2026-05-22

> **Firefox full-page screenshots + OpenClaw skill route hardening.** Platform/core
> package versions, extension manifests, and OpenClaw plugin manifests were
> bumped to `2.8.2`.

### Fixed

- OpenClaw `js-eyes` skill routing now guards against a missing `SkillRegistry`
  during plugin reload/teardown, returning a clear retry message instead of
  throwing `Cannot read properties of null (reading 'executeAction')`.
- The historical action path `skill/js-browser-ops-skill/browser_screenshot`
  is normalized to `skill/js-browser-ops-skill/browser-screenshot`.

### Firefox Screenshots

- `capture_screenshot` accepts `fullPage=true` and Firefox now captures active
  tabs through extension-level scroll-and-stitch screenshots, avoiding
  `html2canvas`, CDN script injection, raw `eval`, and page canvas tainting.
- `browser_screenshot` in `js-browser-ops-skill` now calls the screenshot RPC
  directly and returns PNG data plus page/viewport/segment metadata.
- `@js-eyes/client-sdk` exposes `captureScreenshot()` with `fullPage` metadata
  parity for OpenClaw and skill callers.

## [2.8.1] - 2026-05-20

> **visualMode 简化 + read-mode 改名。** Platform/core package versions, extension
> manifests, and OpenClaw plugin manifests were bumped to `2.8.1`.
> `docs/native-messaging.md` example `pong.version` was bumped to `2.8.1`.

### `@js-eyes/visual-bridge-kit@0.6.0` (BREAKING)

- 删除 `visualMode: 'auto'|'dom'|'hud'|'both'|'off'` 五值枚举，拆成两个正交布尔位
  `hud` / `flash`（顶层 `enabled` 仍是总开关）。
- CLI 新增 `--visual-hud` / `--no-visual-hud` / `--visual-flash` / `--no-visual-flash`，
  默认都开。旧 `--visual-mode` 命中即列入 `deprecatedFlags`，`parseVisualFlags` 不再
  把它下发到 bridge `config()`，CLI 层 stderr 一次性告警。
- 旧值迁移（caller 手动展开，**不留 alias**）：`auto`/`both` → 都开；`dom` → 关 hud；
  `hud` → 关 flash；`off` → `--no-visual`。

### Skills (BREAKING) — `runTool` 路径轴改名

- `js-x-ops-skill` 3.1.0 → 3.2.0、`js-reddit-ops-skill` 3.8.1 → 3.9.0：
  - CLI `--mode auto|graphql|dom` (x) / `--mode auto|api|dom` (reddit) → `--read-mode ...`；
    旧 `--mode` 抛 `E_BAD_ARG`。
  - `runTool` API：`options.mode` → `options.readMode`，`cmdDef.defaultMode` →
    `cmdDef.defaultReadMode`，返回 `mode` / `requestedMode` → `readMode` /
    `requestedReadMode`。
  - `skill.contract` 各 READ 工具 schema：`mode` 字段改名 `readMode`。
  - `runToolAudit.{mode, requestedMode}` → `{readMode, requestedReadMode}`。
- `js-browser-ops-skill` 2.3.0 → 2.4.0：仅跟随 visual-bridge-kit 0.6.0 拆 hud/flash。

迁移成本：搜替 `--mode` → `--read-mode`、`--visual-mode hud` → `--no-visual-flash`、
`--visual-mode dom` → `--no-visual-hud`、`--visual-mode off` → `--no-visual`、
代码里 `mode:` 字段（runTool 调用 / cmdDef defaults）→ `readMode:` / `defaultReadMode:`。

## [2.8.0] - 2026-05-17

> **OpenClaw single-tool router.** JS Eyes now exposes exactly one OpenClaw tool,
> `js-eyes`. Browser automation, skill management, security reloads, and child
> skill actions are routed through path-style `action` values plus an `args`
> object, so OpenClaw no longer sees one tool per built-in command or skill.

### Breaking

- OpenClaw no longer registers individual `js_eyes_*` tools. Agents must call
  `tool: js-eyes` with `action` values such as `browser/get-tabs`,
  `browser/open-url`, `skills/reload`, `security/reload`, or
  `skill/<skillId>/<action>`.
- Old `js_eyes_*` action names are intentionally not retained as aliases. This
  keeps the OpenClaw surface strict and makes failed migrations visible.
- Skill tools are no longer registered directly with OpenClaw. `SkillRegistry`
  runs in router mode for the plugin, maintains internal action bindings, and
  dispatches skill calls via `executeAction()`.

### Added

- `openclaw-plugin` registers a single `js-eyes` router tool with `action` and
  `args` parameters.
- Built-in plugin operations now live in an internal action map:
  `browser/get-tabs`, `browser/list-clients`, `browser/open-url`,
  `browser/get-html`, `browser/execute-script`, `browser/get-cookies`,
  `skills/discover`, `skills/plan-install`, `skills/reload`, and
  `security/reload`.
- Skill metadata now includes generated path-style `actions`, and the CLI shows
  actions instead of OpenClaw tool names in `js-eyes skills list/install`
  output.
- Tests cover the single-tool registration contract, router-mode skill
  dispatch, action metadata generation, and rejection of old action names.

### Changed

- `SENSITIVE_TOOL_NAMES` and sensitive action wrapping now use path-style action
  names, preserving confirm/deny behavior under the single router.
- `README.md`, `docs/README_CN.md`, `SKILL.md`, site copy, i18n assets,
  `docs/skills.json`, and OpenClaw plugin metadata were updated to describe the
  one-tool action model.
- Platform/core package versions, extension manifests, and OpenClaw plugin
  manifests were bumped to `2.8.0`.
- `docs/native-messaging.md` example `pong.version` was bumped to `2.8.0`.

### Migration Notes

- Replace calls like `js_eyes_get_tabs` with:
  `tool: js-eyes`, `action: browser/get-tabs`, `args: {}`.
- Replace skill tool invocations with:
  `tool: js-eyes`, `action: skill/<skillId>/<action>`, `args: { ... }`.
- Keep OpenClaw allowlists focused on `js-eyes`; use `security.toolPolicies`
  for per-action confirmation on sensitive paths.

## [2.7.0] - 2026-05-03

> **Visual-trace → video pipeline (Phase 2) lands.** Visual events now travel
> with full geometry (`viewport`, `anchor.rect`), optional background frame
> sequences captured via a new `capture_screenshot` extension RPC, and a
> built-in PII redaction contract carried through to the offline replay. The
> `@js-eyes/visual-replay-hyperframes` translator gains four-track output and
> can drive `npx hyperframes render` end-to-end into MP4. CLI surface, server
> WS protocol, native-host stdio frame format, and the policy / consent /
> egress runtime are byte-for-byte compatible with 2.6.3 — `js-eyes skills
> update js-eyes` is a drop-in upgrade for read-only consumers.

### Added

- **`@js-eyes/visual-bridge-kit@0.4.0`** — Phase 2 of the visual-trace → video
  pipeline lands. Visual events now travel with full geometry, optional
  background frames, and PII-redact metadata, end to end:
  - `bridge/visual.common.js@0.2.0` — every emit() call now carries
    `viewport: { w, h, dpr, scrollX, scrollY }` plus `anchor.rect: { x, y, w, h }`
    on `before`/`flash`/`after`/`relation` events. New `redactSelectors` config
    suppresses `anchor.rect` for any element whose bounding box overlaps a
    matched selector — defence in depth so PII rects never reach disk.
  - `node/runVisual.js` — `wrapCallApi`/`wrapInjectCall` pick up an optional
    `captureFrame(info)` hook (fire-and-forget) and stash the resulting frame
    metadata in the result. `attachFrameRefsToEvents` ties each frame to the
    closest `before`/`after`/`error` event by ts.
  - `node/captureFrame.js` (new) — `makeFrameWriter({ recordDir, getTabId,
    captureScreenshot, throttle })` returns a hook that decodes
    `data:image/png;base64,...` from `chrome.tabs.captureVisibleTab` (via the
    new `BrowserAutomation.captureScreenshot` SDK method) and writes
    `<recordDir>/frames/<ts>.png`. Default throttle: max 60 frames / session,
    min 250 ms between writes.
  - `node/visualConfig.js` — adds `--redact-rect "x,y,w,h"` /
    `--redact-selector <css>` / `--redact-config <file.json>` flags. Output
    surface gains `{ redact: { rects, selectors } }`, written into
    `meta.json` so the offline replay can paint mosaic over saved frames.
- **chrome extension `@2.7.0`** — adds the `capture_screenshot` RPC routed
  through `chrome.tabs.captureVisibleTab(windowId)`. Background tabs return
  `{ skipped: 'tab_not_active' }` instead of erroring; the field is forwarded
  through `@js-eyes/server-core` and the per-skill SDK copy.
- **firefox extension `@2.7.0`** — mirrors the Chrome implementation through
  `browser.tabs.captureVisibleTab(windowId)`; same `allowedActions` extension
  in `extensions/firefox/config.js` and same fire-and-forget contract in
  `extensions/firefox/background/background.js::handleCaptureScreenshot`.
  Existing `tabs` / `activeTab` / `<all_urls>` permissions in the MV2 manifest
  already cover the new API — no AMO permission delta vs 2.6.3.
- **`@js-eyes/server-core@2.7.0`** — `ws-handler.js` forwards the new
  `capture_screenshot` automation message to the extension and resolves the
  matching `capture_screenshot_complete` reply (with `tabId`, `windowId`,
  `format`, `dataUrl`, `width`, `height`, optional `skipped`) back to the
  caller. Both `BrowserAutomation.captureScreenshot()` (skill-side SDK copy)
  and `@js-eyes/client-sdk` carry the same shape.
- **`@js-eyes/visual-replay-hyperframes@0.2.0`** — translator now produces a
  full multi-track composition:
  - track 0: PNG frame sequence (background plate; falls back to single
    gradient clip when no frames are present);
  - track 1: HUD (existing);
  - track 2: Flash boxes positioned by `anchor.rect`, tone-driven by the
    shared palette;
  - track 3: Relation lines + dots assembled from `relate.from/to.rect`.
  - Composition copies `<sessionDir>/frames/` into `<outDir>/frames/` so the
    bundle is self-contained for `npx hyperframes render`. Composition
    dimensions auto-detect from the first event's `viewport` (falls back to
    1280×720). Redact rects from `meta.json` are painted as static
    backdrop-filter mosaic on top of all tracks but below the watermark.
  - Standalone preview fallback still loops via
    `tl.repeat(-1).repeatDelay(0.6)` set at runtime — keeps `hyperframes lint`
    at 0 errors (only non-blocking density / file-size warnings remain).
- **`js-browser-ops-skill@2.3.0`** & **`js-reddit-ops-skill@3.6.0`** —
  - both wire the captureFrame writer through their dispatch edges
    (`withVisual` / `wrapCallApi`) when `--visual-record` is set;
  - both forward `redact: { rects, selectors }` into `appendVisualSession` so
    `meta.json` carries the contract for downstream replay;
  - both bump `@js-eyes/visual-bridge-kit` to `^0.4.0`.

- **`@js-eyes/visual-bridge-kit@0.2.0`** — adds a second adoption mode for skills
  that drive the page through one-shot `executeScript` injection (no long-lived
  bridge), in addition to the existing long-lived bridge mode used by
  `js-reddit-ops-skill`:
  - `node/runVisual.js::wrapInjectCall(ctx, hint, fn, hooks)` — same
    before/after/drain semantics as `wrapCallApi`, but bundles
    `visual.common.js` + site anchor resolver into the `before` payload so
    every tool call self-bootstraps. The IIFE's `__installed` short-circuit
    keeps repeated injection cheap.
  - `node/loadKit.js::loadVisualKitSource({ siteAnchorPath })` — module-level
    cache that returns `visual.common.js` (+ optional site-specific
    `_visual-<site>.js`) as a single string ready to splice into a Node-side
    expression.
  - `parseVisualFlags(opts, siteDefaults)` now accepts a per-site default
    object so each skill can pin a distinct default `prefix` (e.g.
    `__jse_browser_visual_`, `__jse_reddit_visual_`) without losing user
    overrides via `--visual-prefix`.
- **`js-browser-ops-skill@2.2.0`** — first adopter of the one-shot inject
  pathway, gaining the same HUD + flash + jsonl trace experience as
  `js-reddit-ops-skill` while leaving its declarative `generate*Script`
  helpers (read / click / fill / wait / scroll / screenshot) byte-for-byte
  unchanged. CLI surface mirrors reddit:
  `--visual / --no-visual / --visual-detail / --visual-ms / --visual-mode /
  --visual-trace / --visual-list-stride / --visual-prefix`.
- **`js-reddit-ops-skill@3.5.0`** — original adopter of the long-lived bridge
  pathway. The kit ships with:
  - `bridge/visual.common.js` — pure-page IIFE that installs
    `window.__jse_visual` (config / flashElement / flashRelation / showHud /
    announceStage / cleanup / before / after / drainEvents).
  - `node/bridgeIncludes.js::makeBridgeExpander` — generic
    `// @@include <path>` preprocessor (relative + `@scope/pkg/...` package
    paths) replacing the bespoke `expandBridgeSource` that each skill had to
    re-implement.
  - `node/runVisual.js::wrapCallApi` / `drainVisualEvents` — dispatch-edge
    hooks so business code stays zero-touch.
  - `node/visualConfig.js::parseVisualFlags` — single source for the
    `--visual / --no-visual / --visual-detail / --visual-ms / --visual-mode /
    --visual-trace / --visual-list-stride / --visual-prefix` CLI surface.
  - `node/visualTrace.js::appendVisualTrace` — jsonl recorder for replay /
    headless observability.

### Changed

- **Platform core packages bumped to `2.7.0`** *(2026-05-03)*: root
  `package.json`, `apps/{cli,native-host}`, `packages/{config,client-sdk,
  devtools,protocol,runtime-paths,server-core,skill-recording}`,
  `openclaw-plugin/`, and `extensions/firefox/popup` move together; their
  internal `@js-eyes/*` cross-package version pins (`apps/cli`,
  `apps/native-host`, `packages/{client-sdk,config,server-core,
  skill-recording}`) are updated in lockstep. `packages/visual-bridge-kit`
  (`0.4.0`) and `packages/visual-replay-hyperframes` (`0.2.0`) keep their
  independent 0.x semver cadence; per-platform skills (`reddit@3.6.0`,
  `browser-ops@2.3.0`, `x-ops@3.0.6`, …) keep their own.
- **Hero-badge `v2.6.3` → `v2.7.0`** in `src/index.html`, `docs/index.html`,
  and the four `i18n/locales/{en-US,zh-CN}.js` files (mechanical, via the
  same regex `bumpHeroBadgeVersions` path the `npm run bump` script uses).
- **`docs/native-messaging.md`** — `pong` example bumped to
  `"version":"2.7.0"`. Other "since 2.6.3" prose preserved as historical
  reference.
- **`SKILL.md` frontmatter `version`**, **`docs/skills.json` `parentSkill.version`**,
  **`README.md` Security Posture section title and version table**, and
  **`SECURITY.md` opening note** all advance to `2.7.0`. Historical "since
  2.6.3 …" narrative paragraphs are left intact.

### Fixed

- **`packages/visual-replay-hyperframes/lib/translator.js::renderFrameClips`**
  *(2026-05-03)* — frame-clip inline style had nested double-quotes
  (`style="background-image: url(\"frames/<ts>.png\");"`) which truncated
  the HTML `style` attribute at the first inner `"`, causing the background
  plate to render as a solid black panel. URL is now wrapped in single
  quotes (with `'` in the URL itself percent-encoded). Verified by the new
  Firefox 2.7.0 baseline (HUD + frame-plate render together; `npx
  hyperframes lint` reports `0 errors, 0 warnings`).
- **`packages/visual-replay-hyperframes/lib/timeline.js::collectFrameClips`**
  *(2026-05-03)* — when a `wrapCallApi` / `wrapInjectCall` invocation runs
  against a non-active tab, the extension's `capture_screenshot` RPC
  returns `{ skipped: 'tab_not_active' }` and `captureFrame.js` correctly
  refuses to write the PNG, but the **frame metadata** was still being
  appended to `entry.frames` and forwarded into `events.jsonl`. The
  translator then placed those orphan frame clips at their original `ts`,
  which for a session whose first real visual event arrives later (e.g.
  `navigate-search` → `search` flow) computes to **negative** seconds
  relative to `events[0].ts`. GSAP happily registers `tl.fromTo(..., -114)`,
  the standalone preview never paints any frame, and the user sees a fully
  black stage. Hardened in two layers:
  1. `collectFrameClips` now drops any frame whose `ts < startMs` (the ts
     of the first real visual event), so a stale `entry.frames` entry from
     a previous skipped call cannot contaminate the timeline; and
  2. when `translate(sessionDir, …)` knows the session directory, it
     filters frame clips against `fs.existsSync(path.join(sessionDir,
     frameRef))`, dropping references whose PNG never made it to disk.
- **`packages/visual-replay-hyperframes/lib/timeline.js`** *(2026-05-03)*
  — flash clips on track 2 used a fixed `0.6 s` duration. Two flashes
  emitted within ≤0.6 s of each other (e.g. an `after`-state success
  flash on the same anchor as the first `staggerFlashItems` step) tripped
  hyperframes' `overlapping_clips_same_track` lint error. Each flash's
  duration is now clamped to `min(0.6 s, next_flash.ts − HUD_NUDGE_SEC)`,
  which preserves the visual rhythm under sparse traces and degrades
  gracefully under dense `staggerFlashItems` sequences without changing
  the timeline track count or violating the hyperframes mount-window
  contract.
- **`packages/visual-replay-hyperframes/lib/styleEmbed.js`** /
  `lib/timelineScript.js` *(2026-05-03)* — the standalone HTML preview
  (opening `composition/index.html` directly in a browser without
  `npx hyperframes preview`) now sets `body[data-jse-standalone]` from
  the playback fallback and applies `transform: scale(min(vw/sw, vh/sh))`
  so that 1641 × 885 reddit / browser-ops captures fit into a regular
  laptop viewport. `npx hyperframes preview` and `render` never set the
  attribute, so the deterministic 1:1 stage capture path is unchanged.

### Test fixtures

- `packages/visual-replay-hyperframes/__fixtures__/sess-firefox-2.7.0/` —
  first regression baseline for the Phase 2 pipeline. Real-tab
  `events.jsonl` + `meta.json` + `frames/` produced by Firefox 2.7.0 against
  `https://github.com/imjszhang/hyperframes`. See the fixture's `README.md`
  for the regenerate / lint workflow. Do not regenerate routinely — schema
  changes should show up as a diff against this snapshot.

### Compatibility

- **WS / native-host wire protocols unchanged** vs 2.6.3 except for the
  additive `capture_screenshot` / `capture_screenshot_complete` message
  pair (and its `skipped: 'tab_not_active'` field). Old extensions still
  work against a 2.7.0 server and vice versa as long as no caller invokes
  `capture_screenshot`.
- **`visualHint` schema is backward-compatible** — Phase 2 fields
  (`viewport`, `anchor.rect`, `frameRef`, `redact`) default to `null`/absent
  on Phase 1 sessions; the replay translator falls back to the single-color
  `bgClip` when no frames are present, and to a 1280 × 720 stage when no
  `viewport` is observed.
- **PII redaction is opt-in.** Sessions that don't pass `--redact-rect` /
  `--redact-selector` / `--redact-config` produce identical bytes to a
  Phase-2-without-redact output.
- **Upgrade path**: `js-eyes skills update js-eyes` for read-only
  consumers; `npm install` in the bundle root for OpenClaw deployments,
  followed by an OpenClaw restart so the plugin reloads `@js-eyes/server-core`
  with the new `capture_screenshot` forwarder. `js-eyes skills
  link/unlink/reload/relink` remain zero-restart.

### Architecture pivot (post-2.7.0, in-place)

> **Visual replay main pipeline switches from "PNG screenshots + DOM-measured
> coordinate overlays" to "agent payload + HTML-template rendering".** Version
> numbers stay put (`@js-eyes/visual-bridge-kit@0.4.x`,
> `@js-eyes/visual-replay-hyperframes@0.2.x`, `js-reddit-ops-skill@3.6.x`,
> `@js-eyes/server-core@2.7.0`); only the data flow and the offline composition
> change. Motivation: PNG-mode produced flash overlays that drifted on viewport
> resize and DOM reflow, and the screenshot intrinsically carried noise (ads /
> sidebar / decoration) that the video did not need.

#### Data-flow changes

- **`@js-eyes/visual-bridge-kit/bridge/visual.common.js@0.3.0`** — `emit()` no
  longer injects `viewport` / `anchor.rect` / `relate.from.rect` /
  `relate.to.rect`. In-page `flashElement` / `flashRelation` / `showHud` still
  paint live cues (so Firefox-side runtime feedback is unchanged) but the
  recorded `events.jsonl` shape is now coordinate-free.
- **`@js-eyes/visual-bridge-kit/node/runVisual.js`** — `wrapCallApi` /
  `wrapInjectCall` add a new `hooks.extractPayload(resp, hint, err) → payload`
  hook. Skills attach business data (post titles, scores, comments, …) via this
  hook; the kit threads `summary.payload` through `bridge.after()` and the
  result lands as `event.payload` on the `'after'` event in `events.jsonl`.
  `hooks.captureFrame` is no longer auto-wired — to opt back into PNG capture
  for dev/debug, import `makeFrameWriter` from
  `require('@js-eyes/visual-bridge-kit/dev')` (new sub-path) and pass it
  explicitly.
- **`@js-eyes/visual-bridge-kit` top-level `index.js`** — drops `makeFrameWriter`,
  `writeFrameSync`, `buildFrameRef`, `attachFrameRefsToEvents` from the public
  surface. New sub-path `@js-eyes/visual-bridge-kit/dev` re-exports them for
  dev / regression use. `package.json` declares the new `exports` map.
- **`@js-eyes/visual-bridge-kit/node/visualTrace.js`** — `meta.json` gains
  `payloadSchemaVersion: 1`. Stops writing `meta.redact` / `meta.frameCount`.
- **`@js-eyes/visual-bridge-kit/node/visualConfig.js`** — `parseVisualFlags`
  output gains `deprecatedFlags: string[]` for CLI consumers to print a
  one-shot stderr warning. The flags `--redact-rect`, `--redact-selector`,
  `--redact-config`, `--visual-record-frames`, `--visual-frames-throttle` are
  still parsed (no error), but no longer reach the bridge / translator.

#### Offline replay rewrite

- **`@js-eyes/visual-replay-hyperframes/lib/translator.js`** — full rewrite.
  Removes `pickViewport`, `copyFrames`, `buildRedactBlocks`,
  `renderFrameClips`, `renderFlashClips` (coordinate-based), `relationGeometry`.
  New flow: `readVisualSession` → `buildTimeline` → for each
  `(before, after)` pair, look up `templates/registry.js::getTemplate(skillId,
  hint.kind)` and render a HTML card. Composition is responsive (`vw` /
  `clamp` / `max-width`); no fixed pixel dimensions.
- **`@js-eyes/visual-replay-hyperframes/lib/timeline.js`** — drops
  `collectFrameClips`, the `sessionDir` parameter, and the `fs` dependency.
  Output now has `{ hud, flash, relation, before, after }` only. Each `flash`
  clip carries a stable `anchorId` (e.g. `t3_xxx`, `sub:foo`) extracted from
  `event.anchor.spec` instead of a pixel `rect`.
- **`@js-eyes/visual-replay-hyperframes/lib/timelineScript.js`** — drops the
  GSAP frames track. `flash` clips no longer `fromTo` an absolute-positioned
  `<div>`; they call `tl.add(() => element.classList.add('flash-active'), t)`
  on `[data-anchor-id="<spec>"]` nodes. CSS `@keyframes jse-flash-pulse` runs
  the outline + glow animation. Cards self-position; flash follows the card.
- **`@js-eyes/visual-replay-hyperframes/lib/styleEmbed.js`** — drops
  `.jse-vis-clip-frame`, `.jse-vis-redact`, `body[data-jse-standalone]` scale
  hack. Adds reddit-style card CSS (`.reddit-card`, `.reddit-info-card`,
  `.reddit-comment-tree`, `.reddit-nav-card`), `.jse-hud` (fixed top-right),
  flash keyframes, and progress bar.
- **`@js-eyes/visual-replay-hyperframes/templates/`** (new directory) —
  - `registry.js` — `register(skillId, kind, renderer)` /
    `getTemplate(skillId, kind)`.
  - `reddit/index.js` registers five `kind` renderers under
    `js-reddit-ops-skill` and the `'*'` wildcard fallback.
  - `reddit/list.js` renders up to 8 reddit-style post cards.
  - `reddit/item.js` renders a single post card or a `summary + fields` info
    card fallback.
  - `reddit/tree.js` renders an indented comment tree (depth inferred from
    `payload.relations` or `payload.items[*].depth`).
  - `reddit/global.js` renders a `summary + key/value` info card.
  - `reddit/navigation.js` renders a `from → to` URL transition card.
  - `reddit/cardTemplate.js` shared HTML helpers (`renderCard`,
    `fmtCount`, `fmtRelativeTime`).
- **`@js-eyes/visual-replay-hyperframes/cli/jse-replay.js`** — output stats
  switch to `{ hudCount, flashCount, relationCount, cardCount,
  totalDataItems, frameCount: 0 }` and stderr now reports `frames: 0 (PNG
  pipeline deprecated post-2.7.0)`. New `--skill <id>` flag for explicit
  template routing. `--width / --height / --frames-debug` are accepted for
  backward-compat but print a deprecated-flag notice.

#### Skill-side updates (`js-reddit-ops-skill@3.6.x`)

- **`lib/visualHint.js`** — adds `extractPayload(resp, hint, err)` plus
  helpers `extractRedditItemFields`, `extractGlobalFields`. Routes by
  `hint.kind` and produces the schema described in the kit README.
- **`lib/runTool.js`** / **`cli/index.js`** — drop `makeFrameWriter` /
  `__visualFrames` extraction / `redact` propagation. Pass
  `hooks.extractPayload` to `wrapCallApi`. Print one-shot deprecated-flag
  warning via `lib/cliVisualFlags.js::warnDeprecatedFlagsOnce`.
- **`lib/cliVisualFlags.js`** (new) — single source of truth for the
  deprecated-flag warning helper (`warnDeprecatedFlagsOnce`).
- **`lib/commands.js`** — `parseArgv` now accepts (and silently ignores)
  `--visual-record-frames` / `--visual-frames-throttle` so older scripts
  don't crash with "unknown option". `printHelp` documents the deprecation.

#### Browser-ops skill

- `js-browser-ops-skill@2.3.0` retains its 2.7.0 wiring but is no longer
  hooked up to a HTML template (no `js-browser-ops-skill` templates registered
  in this round). Its visual sessions still record correctly but produce a
  HUD-only composition through the wildcard `'*'` fallback. A dedicated
  template (open URL preview / scroll / extract preview) is queued for the
  next minor.

#### Fixtures

- New `packages/visual-replay-hyperframes/__fixtures__/sess-reddit-list-html/`
  — A-route main-pipeline baseline (`payload`, no `frames/`, no
  `anchor.rect`). README describes regeneration.
- Existing `packages/visual-replay-hyperframes/__fixtures__/sess-firefox-2.7.0/`
  — README updated to "PNG-mode archived baseline (DEPRECATED post-2.7.0)".
  Fixture is preserved unchanged for dev regression of `captureFrame.js` and
  `attachFrameRefsToEvents`.

#### Compatibility & migration

- **`events.jsonl` is one-way forward-compatible**: A-route translator falls
  back to a HUD-only stage when an entry has no `payload`; B-route (PNG)
  translator no longer exists at the top level (use `dev/index.js` if you
  need it). Old PNG-mode bundles still load through the new translator —
  cards just render with empty placeholder content.
- **CLI surface stays back-compat**: every removed flag is still parsed,
  prints a one-shot stderr warning, and is otherwise a no-op.
- **In-page runtime is unchanged**: `--visual` still paints HUD + flash in
  the live tab. Only the recording / replay path changed.
- **Versions stay put**: `@js-eyes/visual-bridge-kit@0.4.x`,
  `@js-eyes/visual-replay-hyperframes@0.2.x`,
  `js-reddit-ops-skill@3.6.x`, `js-browser-ops-skill@2.3.0`,
  `@js-eyes/server-core@2.7.0`.

## Visual stack follow-up — 2026-05-04

> **Platform / monorepo semver unchanged (`@js-eyes/*` → `2.7.0`).** Extensions and
> server WS contracts from 2026-05-03 stay as documented above. Entries below summarise
> the same-day git lineage (`02e1bcf` … `6051591`) for the offline replay toolchain and
> `js-reddit-ops-skill`. Per-workspace **`CHANGELOG.md`** files carry fully enumerated
> bullet lists (`packages/visual-replay-hyperframes`, `skills/js-reddit-ops-skill`, …).

### Added

- **`@js-eyes/visual-bridge-kit@0.5.2`** *(git `8423c2a`)* — snapshot photography on
  the stable surface again: JPEG/PNG `captureFrame` path (`makeFrameWriter`,
  `writeFrameSync`, `attachFrameRefsToEvents`), `wrapCallApi` awaits the hook +
  ring-buffer bookkeeping, `updateVisualSessionMeta` when sessions are appended,
  README notes that HUD / flash overlays are included in screenshots.
- **`js-reddit-ops-skill@3.8.x`** *(same window)* — `makeFrameWriter` plumbed through
  `wrapCallApi` behind `--visual-record`, emitting `frame` events and on-disk JPEGs
  (throttled; nav retries fire `pre-nav` / `post-nav` grabs). New CLI knobs:
  `--frames` / `--no-frames`, `--hi-dpi`, `--max-frames` (skill changelog for quotas).
  **`replay-templates/`** publishes Reddit `list` / `item` renderers once they migrate
  out of the translator package (**`@js-eyes/visual-replay-hyperframes@0.7.2+`**).
- **`@js-eyes/visual-replay-hyperframes@0.7.0+`** *(git `97577c1`, `5acda28`, `6051591`)* —
  plugin host (`pluginHost.js`, `pluginContext.js`), reference builtins **`@builtin/hud` /
  `@builtin/flash`**, community **`@js-eyes/spotlight`**, repeatable `--plugin` loading +
  `--plugin-config`, `plugins/README.md` contract & `sample-local-plugin.js` fixture.

### Changed

- **DOM-first visual events** *(git `02e1bcf`)* — `dom_locate` / `dom_click` / `dom_type`
  (plus supporting bridge work and `_dom-actions.js`) propagate through reddit bridges and
  the translator/timeline/registry stack; Reddit card shells and fallback templates expand
  until the **`0.6.0`** prune below.
- **`@js-eyes/visual-replay-hyperframes@0.6.0`** *(git `72f4eae`)* —
  **snapshot-first maintenance ("snapshot-only-prune").** Drops ~1180 LOC of Reddit chrome
  simulation, page-header scaffolding, unused templates (`global`, `navigation`, comment
  tree, synthetic headers), **`lib/shellLayout.js`**, and **`cli/jse-template-scaffold`** —
  compositions lean on screenshot plates + `_generic` + minimal Reddit fallbacks (`timeline.js`
  regains PNG frame sequencing for snapshot mode).

### Breaking / migration

- **CLI tightening (`0.7.1`)** *(git `97577c1`)* — rejecting `--effects=hud|flash|…` and
  `--all-effects`; use **`--plugin=@builtin/hud`** / **`--plugin=@builtin/flash`** explicitly
  (translator `opts.effects` remains valid for programmatic callers).
- **External Reddit templates (`0.7.2`)** *(git `5acda28`)* —
  **`translate(opts)`** / **`jse-replay`** accept **`opts.templateBootstrap`**, CLI
  **`--template-bootstrap`**, env **`JSE_REPLAY_TEMPLATE_BOOTSTRAP`**, or the relative
  `../../replay-templates/index.js` discovery path for bundles under **`runs/`**; callers
  who only depended on npm **must** supply the bootstrap when none of those apply.
- **Skill snapshot defaults (`3.8.x`)** — `--visual-record` now captures JPEG frames unless
  disabled with **`--no-frames`** (CI / throughput opt-out).

### Fixed

- **Reddit `user-bridge` navigation (`js-reddit-ops-skill`)** *(git `fd2d2d6`)* —
  deprecated **`/user/.../overview`** targets map back to the default profile homepage,
  **`runTool`** may issue **two** navigations before surfacing failure on stubborn 404s,
  empty profile responses bail early instead of spinning.

### Replay polish

- **`0.7.3`–`0.7.5`** *(published same day)* — softened then hardened snapshot transitions:
  longer cross-fade + skip duplicate opener keyframe, teardown of stacked opacity timeouts,
  final **single-layer hard cut** for background swaps (drops dual-buffer fade artefacts).
  See `packages/visual-replay-hyperframes/CHANGELOG.md` for timings and rationale.

## [2.6.3] - 2026-05-02

> **Install-time UX release — zero behavioural changes at runtime.** Closes a
> long-standing first-install footgun where users who registered the Native
> Messaging host before the JS Eyes server had ever started would click the
> popup's **Sync Token From Host** / 从本机同步 button and silently get
> `token-missing` from the host because `~/.js-eyes/runtime/server.token`
> didn't exist yet. Wire protocol, CLI contract, default config values, every
> public API, and the entire policy / consent / egress runtime are
> byte-for-byte compatible with 2.6.2 — `js-eyes skills update js-eyes` is a
> drop-in upgrade.

### Changed

- **`bin/js-eyes-native-host-install.sh` / `.ps1`** *(2026-05-02)*: After
  registering the browser native-messaging manifest + launcher, both
  scripts now also run `node apps/cli/bin/js-eyes.js server token init` —
  `ensureToken()` is idempotent, so it's a no-op when the token file
  already exists. New `--skip-token-init` flag (PowerShell:
  `-SkipTokenInit`) and `JS_EYES_SKIP_TOKEN_INIT=1` env var let operators
  opt out (e.g. for headless deployments where the token will be set via
  `JS_EYES_SERVER_TOKEN`). The `node` invocations are no longer `exec`'d
  so the second command can run after the first; the script's exit status
  remains the native-host install's exit code on Windows (PowerShell
  branch preserves `$LASTEXITCODE` from the install step explicitly).
- **`install.sh` / `install.ps1`** *(2026-05-02)*: One-line installer now
  runs `npx js-eyes server token init` **before** `npx js-eyes native-host
  install --browser all`, mirroring the launcher behaviour. Failures in
  either step downgrade to a `warn` and leave the install in a recoverable
  state (banner Tip points the user at the manual remediation). New
  `--skip-token-init` flag and `JS_EYES_SKIP_TOKEN_INIT=1` env var.
  `docs/install.sh` / `docs/install.ps1` are kept in lockstep via
  `INSTALL_SCRIPTS` in `packages/devtools/lib/builder.js`.
- **`SKILL.md` documents the token-first ordering as a hard prerequisite**
  *(2026-05-02)*: `Setup Workflow` step 8 was rewritten as an explicit
  three-way choice ("any one is enough: `server token init`, the launcher,
  or starting OpenClaw / `server start`"). The `Browser Extension
  Connection` flow gained an explicit "make sure the host has a token to
  share" step before the native-host install. The
  `Browser Extension Stays Disconnected` troubleshooting block grew two
  new entries — `token-missing` from `~/.js-eyes/logs/native-host.log`,
  and `Could not establish connection` from a stale browser process. The
  `Deployment Modes` Native Messaging blurb now explicitly contrasts the
  launcher path (auto-seeds token) and the npx fallback (does not).
- **`docs/native-messaging.md`** *(2026-05-02)*: Install section makes the
  npx-vs-launcher token-seeding asymmetry explicit; npx users are told to
  pair `npx js-eyes native-host install` with `npx js-eyes server token
  init`. `pong` example bumped to `"version":"2.6.3"`.

### Compatibility

- **Zero behavioural change at runtime**: server, plugin, browser
  extension, and automation protocol are byte-identical to 2.6.2. Only
  install-time scripts and documentation moved.
- **Wire Protocol Unchanged**: native messaging stdio frame format, server
  WS subprotocol, and the policy engine are untouched.
- **Upgrade Path**: `js-eyes skills update js-eyes` (or reinstall the
  bundle). Existing installations that already had a token file see no
  change. Re-running `bin/js-eyes-native-host-install.sh` on an old install
  is safe — the new `server token init` step is a no-op when the file
  already exists.

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
- `packages/protocol/tests/safe-npm.test.js`: subcommand whitelist, argv immutability,
  `shell:false`, env filtering.
- `packages/protocol/tests/extra-integrity.test.js`: snapshot → unchanged → drift (modified /
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

- **Security config hot-reload — `egressAllowlist` without restart** _(2026-04-20)_: Editing `security.egressAllowlist` (and a small whitelist of other hot-safe fields) in `~/.js-eyes/config/config.json` now takes effect on the running JS Eyes server **without** restarting OpenClaw. Server-core ships its own chokidar watcher on the config file (option `hotReloadConfig`, default `true`, with 300 ms debounce and graceful fallback when chokidar is not installed) plus a new `server.reloadSecurity({ source })` handle. A per-connection `PolicyContext` cache was the root cause of the previous "I edited config but `open_url` still returns `pending-egress`" confusion — reloads now bump `state.policyGeneration`, and `getOrCreatePolicyForClient` rebuilds stale per-connection policies from the live `state.security` on the next automation call. Hot-reloadable fields: `egressAllowlist`, `toolPolicies`, `sensitiveCookieDomains`, `allowedOrigins`, `enforcement`. Everything else (e.g. `allowAnonymous`, `allowRemoteBind`, `serverHost`/`serverPort`, token) is recorded under `ignored` in the reload summary and still requires a restart. New built-in tool `js_eyes_reload_security` (agent-driven) and new CLI preview `js-eyes security reload` (read-only dry run). New audit events: `config.hot-reload`, `config.hot-reload.error`, `automation.policy-rebuilt`. `GET /api/browser/status` now exposes `data.policy.generation` and `data.policy.egressAllowlist` for external verification. Files: [packages/server-core/index.js](packages/server-core/index.js), [packages/server-core/ws-handler.js](packages/server-core/ws-handler.js), [packages/config/index.js](packages/config/index.js) (new `resolveHotReloadableSecurity`), [apps/cli/src/cli.js](apps/cli/src/cli.js), [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs). New tests in [packages/server-core/tests/security-hot-reload.test.js](packages/server-core/tests/security-hot-reload.test.js).

### Fixed

- **Skill tool schema is now visible to OpenClaw / LLM** _(2026-04-20)_: `SkillRegistry`'s per-tool dispatcher was previously registered with a placeholder `{ type: 'object', properties: {} }` schema and a generic `[js-eyes dispatcher] <name>` description, so OpenClaw (and the LLM behind it) never saw the real `label`/`description`/`parameters` (including `required` / `anyOf`) declared by the skill contract. This made models silently omit required arguments, e.g. `mastodon_get_status` being invoked without `url` or `tabId` and failing at runtime with `必须提供 url 或 tabId 其中之一`. The dispatcher now carries the contract's real metadata on first registration, and hot-reloads mutate the dispatcher object in place (by reference) so schema updates propagate to hosts that retain the tool object by reference; a one-time OpenClaw restart is still suggested for hosts that snapshot tool metadata at registration time. Files: [packages/protocol/skill-registry.js](packages/protocol/skill-registry.js), [packages/protocol/tests/skill-registry.test.js](packages/protocol/tests/skill-registry.test.js), [docs/dev/js-eyes-skills/deployment.zh.md](docs/dev/js-eyes-skills/deployment.zh.md).

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
