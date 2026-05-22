# Release Notes

## v2.8.2

> **Firefox full-page screenshots.** This release fixes OpenClaw skill-route
> stability around hot reloads and adds extension-level `fullPage=true`
> screenshots for Firefox active tabs.

### Highlights

- **Firefox full-page screenshots**: `capture_screenshot` now supports
  `fullPage=true` through scroll-and-stitch capture in the Firefox extension.
- **No html2canvas fallback**: long screenshots no longer rely on CDN injection,
  raw `eval`, or page-world canvas serialization.
- **OpenClaw route hardening**: `skillRegistry` reload gaps now return a clear
  retry message, and `browser_screenshot` is accepted as a compatibility alias
  for `browser-screenshot`.
- **Platform bump**: CLI、扩展、OpenClaw plugin、`@js-eyes/*` 核心包同步至 `2.8.2`。

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.8.2/js-eyes-chrome-v2.8.2.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.8.2/js-eyes-firefox-v2.8.2.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.8.2/js-eyes-skill-v2.8.2.zip)
- [ClawHub Skill (`js-eyes@2.8.2`)](https://clawhub.ai/imjszhang/js-eyes)

### Installation Instructions

1. Upgrade the `js-eyes` bundle to `2.8.2` and run `npm install` in the bundle
   root.
2. Install/reload the Firefox extension `2.8.2` to enable full-page screenshot
   stitching.
3. Restart OpenClaw if the plugin is loaded so router + skill bindings reload.

## v2.8.1

> **visualMode 简化 + read-mode 改名。** `@js-eyes/visual-bridge-kit@0.6.0` 将
> `visualMode` 五值枚举拆成正交的 `hud` / `flash` 布尔位；部分 ops skill 将
> `runTool` 的 `mode` 轴改名为 `readMode`（CLI `--read-mode`）。

### Highlights

- **Visual flags**: `--visual-hud` / `--no-visual-hud` / `--visual-flash` /
  `--no-visual-flash` 取代 `--visual-mode`；旧 flag 仅 stderr 告警，不再下发到 bridge。
- **read-mode 轴**: `js-x-ops-skill` 3.2.0、`js-reddit-ops-skill` 3.9.0 将
  `--mode` / `options.mode` 改名为 `--read-mode` / `options.readMode`（breaking）。
- **Platform bump**: CLI、扩展、OpenClaw plugin、`@js-eyes/*` 核心包同步至 `2.8.1`。

### Migration Notes

- `--visual-mode hud` → `--no-visual-flash`；`dom` → `--no-visual-hud`；`off` →
  `--no-visual`。
- 脚本/代理调用：搜替 `--mode` → `--read-mode`，`mode:` → `readMode:` /
  `defaultReadMode:`。

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.8.1/js-eyes-chrome-v2.8.1.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.8.1/js-eyes-firefox-v2.8.1.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.8.1/js-eyes-skill-v2.8.1.zip)
- [ClawHub Skill (`js-eyes@2.8.1`)](https://clawhub.ai/imjszhang/js-eyes)

### Installation Instructions

1. Upgrade the `js-eyes` bundle to `2.8.1` and run `npm install` in the bundle
   root.
2. Restart OpenClaw if the plugin is loaded so router + skill bindings reload.
3. Update scripts that still pass `--visual-mode` or `--mode` on affected ops
   skills.

## v2.8.0

> **OpenClaw now sees one tool: `js-eyes`.** All browser operations, skill
> lifecycle commands, security reloads, and child skill actions route through
> path-style `action` values on the single `js-eyes` tool.

### Highlights

- **Single OpenClaw tool**: the plugin registers only `js-eyes`; previous
  built-ins such as `js_eyes_get_tabs` and per-skill tools are internalized.
- **Path-style actions**: call `browser/get-tabs`, `browser/open-url`,
  `skills/reload`, `security/reload`, or `skill/<skillId>/<action>` with
  `args: { ... }`.
- **Router-mode skills**: `SkillRegistry` keeps hot-reloadable skill bindings
  without registering each skill action as an OpenClaw tool.
- **Security preserved**: sensitive operations still pass through action-level
  policy wrapping and `security.toolPolicies`.

### Migration Notes

- This is a breaking OpenClaw invocation change. Do not call old `js_eyes_*`
  tools or old action names; they are intentionally rejected.
- Allowlist `js-eyes` in OpenClaw, then control sensitive paths through JS Eyes
  policy configuration.
- Existing browser extension protocol and WebSocket automation remain on the
  same protocol version; the main impact is the OpenClaw tool surface.

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.8.0/js-eyes-chrome-v2.8.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.8.0/js-eyes-firefox-v2.8.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.8.0/js-eyes-skill-v2.8.0.zip)
- [ClawHub Skill (`js-eyes@2.8.0`)](https://clawhub.ai/imjszhang/js-eyes)

### Installation Instructions

1. Upgrade the `js-eyes` bundle to `2.8.0` and run `npm install` in the bundle
   root.
2. Restart OpenClaw once so the plugin reloads and registers only `js-eyes`.
3. Update agent prompts or tool-call adapters to send `action` and `args` to
   `js-eyes`.

## v2.7.0

> **Visual-trace → video pipeline (Phase 2).** Visual events now travel with
> full geometry, optional background frames captured straight from the active
> tab via a new `capture_screenshot` extension RPC, and built-in PII redaction.
> `@js-eyes/visual-replay-hyperframes` translates the resulting session bundle
> into a four-track Hyperframes composition that `npx hyperframes render` can
> turn into MP4. Wire protocols, CLI surface, policy / consent / egress runtime,
> and every public API are byte-for-byte compatible with 2.6.3 — modulo the
> additive `capture_screenshot` automation message — so `js-eyes skills update
> js-eyes` is a drop-in upgrade.

### Highlights

- **`capture_screenshot` extension RPC** *(2026-05-02)*: Chrome 2.7.0
  (`chrome.tabs.captureVisibleTab`) and Firefox 2.7.0
  (`browser.tabs.captureVisibleTab`) gain a fire-and-forget RPC that returns
  a base64 PNG of the active tab — or `{ skipped: 'tab_not_active' }` when
  the requested tab is in the background. Forwarded by
  `@js-eyes/server-core@2.7.0` and exposed as `BrowserAutomation.captureScreenshot()`
  in the per-skill SDK copies. Existing Chrome/Firefox permissions cover the
  new API; no AMO permission delta vs 2.6.3.
- **`@js-eyes/visual-bridge-kit@0.4.0`**: every `before` / `flash` / `relation`
  / `after` event now carries `viewport: { w, h, dpr, scrollX, scrollY }` and
  `anchor.rect: { x, y, w, h }`. New `node/captureFrame.js::makeFrameWriter`
  wires the extension RPC to `<recordDir>/frames/<ts>.png` (default cap: 60
  frames / session, 250 ms throttle). New `--redact-rect "x,y,w,h"` /
  `--redact-selector <css>` / `--redact-config <file.json>` CLI flags pipe
  through `parseVisualFlags` into both runtime suppression of `anchor.rect`
  for matched selectors and into `meta.redact.{rects,selectors}` for the
  offline replay.
- **`@js-eyes/visual-replay-hyperframes@0.2.0`** translator now emits a
  four-track composition: track 0 = PNG frame sequence (with single-color
  fallback when no frames are present); track 1 = HUD; track 2 = flash boxes
  bound to `anchor.rect`; track 3 = relation lines + dots from
  `relate.from/to.rect`. Composition dimensions auto-detect from the first
  event's `viewport` (1280 × 720 fallback). Redact rects from `meta.json`
  are painted as a `backdrop-filter: blur` mosaic over all tracks but below
  the watermark. `npx hyperframes lint` reports `0 errors, 0 warnings`.
- **Skill adopters bumped**: `js-browser-ops-skill@2.3.0` and
  `js-reddit-ops-skill@3.6.0` thread the captureFrame writer through their
  dispatch edges (`withVisual` / `wrapCallApi`) when `--visual-record` is
  set, and forward `redact: { rects, selectors }` into `appendVisualSession`
  so `meta.json` carries the contract for downstream replay. Both bump
  `@js-eyes/visual-bridge-kit` to `^0.4.0`.
- **First Firefox 2.7.0 regression baseline** lives at
  `packages/visual-replay-hyperframes/__fixtures__/sess-firefox-2.7.0/`
  (real-tab capture against `github.com/imjszhang/hyperframes` — see the
  fixture's `README.md` for the regenerate / lint workflow).
- **Translator inline-style fix**: `renderFrameClips` previously emitted
  `style="background-image: url(\"frames/<ts>.png\");"` which truncated the
  HTML `style` attribute at the first inner `"`, blanking the frame plate.
  URL is now single-quoted (with `'` percent-encoded inside the URL).

### Migration Notes

- **No breaking changes** in wire protocols, CLI surface, default config
  values, public APIs, or the policy / consent / egress runtime. The
  additive `capture_screenshot` / `capture_screenshot_complete` message
  pair is new; old extensions still work against a 2.7.0 server and vice
  versa as long as no caller invokes `capture_screenshot`.
- **`visualHint` schema is backward-compatible.** Phase 2 fields
  (`viewport`, `anchor.rect`, `frameRef`, `redact`) default to `null`/absent
  on Phase 1 sessions; the replay translator falls back to the single-color
  `bgClip` when no frames are present, and to a 1280 × 720 stage when no
  `viewport` is observed.
- **PII redaction is opt-in.** Without `--redact-rect` /
  `--redact-selector` / `--redact-config` you get the same bytes a
  no-redact 2.7.0 run would produce.
- **Independent semver cadence preserved.** `@js-eyes/visual-bridge-kit`
  stays on `0.4.0` and `@js-eyes/visual-replay-hyperframes` on `0.2.0`;
  per-platform skills (`reddit@3.6.0`, `browser-ops@2.3.0`, `x-ops@3.0.6`,
  …) keep their own.
- **Upgrade path**: `js-eyes skills update js-eyes` for read-only
  consumers; `npm install` in the bundle root for OpenClaw deployments,
  followed by an OpenClaw restart so the plugin reloads
  `@js-eyes/server-core` with the new `capture_screenshot` forwarder.
  `js-eyes skills link/unlink/reload/relink` remain zero-restart.

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.7.0/js-eyes-chrome-v2.7.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.7.0/js-eyes-firefox-v2.7.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.7.0/js-eyes-skill-v2.7.0.zip)
- [ClawHub Skill (`js-eyes@2.7.0`)](https://clawhub.ai/imjszhang/js-eyes)

### Installation Instructions

#### npm CLI

1. `npm install -g js-eyes@2.7.0`
2. `js-eyes doctor --json` — text and JSON outputs are byte-identical to
   2.6.3 except for the `version` field plus the new `capture_screenshot`
   row in the matrix.

#### OpenClaw

1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.7.0 and run
   `npm install` in the bundle root.
2. Restart OpenClaw once so the plugin module reloads
   `@js-eyes/server-core@2.7.0` with the new `capture_screenshot`
   forwarder. Subsequent `js-eyes skills link/unlink/reload/relink` remain
   zero-restart.

#### ClawHub

1. `js-eyes@2.7.0` is published on ClawHub with the `latest` tag pointing to
   2.7.0 and MIT-0 as the platform license.
2. ClawHub's scanner may show `SUSPICIOUS` for this bundle because JS Eyes
   intentionally ships host-side `child_process`, `fs`, and WebSocket plumbing
   for OpenClaw browser automation. The flagged patterns are expected for this
   release and match the documented security posture in `RELEASE.md`.

#### Chrome / Edge

1. Download `js-eyes-chrome-v2.7.0.zip`, extract, reload unpacked (or
   update from the Chrome Web Store once live). Existing permissions
   already cover `chrome.tabs.captureVisibleTab` — no permission prompt
   delta vs 2.6.3.

#### Firefox

1. Install `js-eyes-firefox-v2.7.0.xpi` (or update from AMO once the
   listing is live). Existing `tabs` / `activeTab` / `<all_urls>`
   permissions in the MV2 manifest already cover
   `browser.tabs.captureVisibleTab` — no permission delta vs 2.6.3.

### Pivot note (post-2.7.0, in-place)

> **Visual replay's main pipeline shifted from "PNG screenshots + DOM
> coordinate overlay" to "agent payload + HTML-template rendering" without
> moving any version number.** Versions stay at
> `@js-eyes/visual-bridge-kit@0.4.x`,
> `@js-eyes/visual-replay-hyperframes@0.2.x`,
> `js-reddit-ops-skill@3.6.x`, and `@js-eyes/server-core@2.7.0`. See the
> `### Architecture pivot (post-2.7.0, in-place)` subsection inside
> [`CHANGELOG.md`](CHANGELOG.md) for the full delta. Highlights:
>
> - `events.jsonl` carries `payload` per `hint.kind`; no more `anchor.rect`,
>   `viewport`, or `frameRef` on the main path.
> - `visual-bridge-kit` exposes `hooks.extractPayload(resp, hint, err)` so
>   skills can publish structured business data (titles, scores, comment
>   trees) into the trace.
> - `visual-replay-hyperframes` ships a `templates/` directory with a
>   `templates/registry.js` and a `templates/reddit/` set (list / item /
>   tree / global / navigation). `composition.html` renders responsive
>   reddit-style cards; flash animation is a class toggle on
>   `[data-anchor-id]`, not an absolute-positioned overlay.
> - `--redact-rect` / `--redact-selector` / `--redact-config` /
>   `--visual-record-frames` / `--visual-frames-throttle` /
>   `--width` / `--height` / `--frames-debug` are still parsed but emit a
>   one-shot stderr deprecation warning. `makeFrameWriter` /
>   `writeFrameSync` / `buildFrameRef` / `attachFrameRefsToEvents` move
>   from `@js-eyes/visual-bridge-kit` to
>   `@js-eyes/visual-bridge-kit/dev` (re-exported, unchanged behaviour).
> - In-page runtime cues (HUD, flashing element, relation lines) are
>   unchanged — Firefox / Chrome `--visual` sessions still paint live
>   feedback.
> - New baseline:
>   `packages/visual-replay-hyperframes/__fixtures__/sess-reddit-list-html/`.
>   Old `sess-firefox-2.7.0/` is preserved as a "PNG-mode archived
>   baseline" for `dev/` regression.
>
> No reinstall required; this is a code-path swap only. Existing 2.7.0
> sessions stored on disk replay correctly through the new translator
> (cards render with empty placeholder content when no `payload` is
> present), and the new translator gracefully falls back to a HUD-only
> stage on legacy bundles.

---

## v2.6.3

> **Install-time UX release — zero behavioural changes at runtime.** Closes a
> long-standing first-install footgun where a brand-new operator who registered
> the Native Messaging host before the JS Eyes server had ever been started
> would click the popup's **Sync Token From Host** / 从本机同步 button and
> silently get `token-missing` from the host (because
> `~/.js-eyes/runtime/server.token` didn't exist yet, only created by
> `ensureToken()` during server boot or by an explicit
> `js-eyes server token init`). 2.6.3 makes the launcher and one-line
> installers seed the token file as part of the install path, and rewrites
> the SKILL deployment flow to call out the dependency before the popup is
> ever clicked.
>
> Wire protocol, CLI surface, server policy engine, consent ledger, and every
> public API are byte-for-byte compatible with 2.6.2. `js-eyes skills update
> js-eyes` is a drop-in upgrade.

### Highlights

- **Local launcher seeds the token file** *(2026-05-02)*:
  [`bin/js-eyes-native-host-install.sh`](bin/js-eyes-native-host-install.sh)
  and [`bin/js-eyes-native-host-install.ps1`](bin/js-eyes-native-host-install.ps1)
  now run `node apps/cli/bin/js-eyes.js server token init` after the
  `native-host install` step. `ensureToken()` is idempotent — if the file
  already exists it's a no-op, so re-running the launcher is safe. The
  practical effect: a freshly installed machine where the operator has never
  started OpenClaw yet can still click **Sync Token From Host** the first
  time and get a populated **Server Token** field. Opt out with
  `--skip-token-init` (or `-SkipTokenInit` on Windows) / `JS_EYES_SKIP_TOKEN_INIT=1`.
- **One-line installers seed the token file too** *(2026-05-02)*:
  [`install.sh`](install.sh) / [`install.ps1`](install.ps1) (and their
  `docs/`-mirrored copies that the `https://js-eyes.com/install.sh` route
  serves) now run `npx js-eyes server token init` before the
  `npx js-eyes native-host install --browser all` step, with the same
  `--skip-token-init` / env-var opt-out. The closing banner gained a Tip
  reminding operators to restart the browser before clicking **Sync Token
  From Host**, and what to do if it still reports `token-missing`.
- **`SKILL.md` rewritten around the "token must exist first" prerequisite**
  *(2026-05-02)*:
  - `Setup Workflow` step 8 is now an explicit three-way choice — any one
    of (a) `js-eyes server token init`, (b) the local launcher (which now
    does it for you), or (c) starting OpenClaw / `js-eyes server start` —
    is enough to satisfy the prerequisite.
  - `Browser Extension Connection` gained a dedicated "make sure the host
    has a token to share" step before the launcher invocation.
  - `Browser Extension Stays Disconnected` troubleshooting grew two new
    rows: `Sync Token From Host` reporting `token-missing` (with the
    `~/.js-eyes/logs/native-host.log` smoking-gun line) and `Could not
    establish connection` from a stale browser process that hadn't seen
    the freshly registered manifest.
  - `Deployment Modes` Native Messaging blurb now contrasts the launcher
    path (auto-seeds token) with the `npx` fallback (does **not** seed,
    must be paired with `npx js-eyes server token init`).
- **`docs/native-messaging.md`** *(2026-05-02)*: Install section made the
  asymmetry between launcher and `npx` paths explicit, `pong` example
  bumped to `"version":"2.6.3"`. The 排障 / troubleshooting block already
  covered "token 文件丢失"; that text is unchanged but is now reachable
  from the new SKILL troubleshooting rows.

### Migration Notes

- **No breaking changes.** Every default is identical to 2.6.2; every
  public symbol keeps its prior module path; the wire protocol, server
  WS subprotocol, and policy engine are untouched.
- **Token file location unchanged.** `~/.js-eyes/runtime/server.token` on
  POSIX, `%USERPROFILE%/.js-eyes/runtime/server.token` on Windows. Existing
  installs already have it; the new init step is a no-op for them.
- **Upgrade path**: `js-eyes skills update js-eyes` or reinstall the parent
  bundle. Re-running `bin/js-eyes-native-host-install.sh` on an old install
  is safe — `ensureToken()` will see the existing token and return
  `created: false`. No restart is required for the runtime behaviour
  change because there isn't one.
- **Operators who manage the token themselves** (e.g. via
  `JS_EYES_SERVER_TOKEN`, an external secrets store, or a CI provisioner)
  should add `--skip-token-init` to their launcher / installer invocations
  to avoid the idempotent — but unnecessary — token-file write.

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.3/js-eyes-chrome-v2.6.3.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.3/js-eyes-firefox-v2.6.3.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.6.3/js-eyes-skill-v2.6.3.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.6.3`
2. `js-eyes doctor --json` — text and JSON outputs are byte-identical to
   2.6.2 except for the `version` field; the runtime posture is unchanged.

#### OpenClaw
1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.6.3 and run `npm install`
   in the bundle root.
2. Restart OpenClaw once so the plugin module reloads. Subsequent
   `js-eyes skills link/unlink/reload/relink` remain zero-restart.
3. If you previously hit `token-missing` from the popup on this machine,
   re-run the local launcher
   `bin/js-eyes-native-host-install.sh --browser all` (macOS/Linux) /
   `./bin/js-eyes-native-host-install.ps1 -Browser all` (Windows). 2.6.3
   will seed `~/.js-eyes/runtime/server.token` if it's still missing, then
   restart your browser and click **Sync Token From Host**.

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.6.3.zip`, extract, reload unpacked (or
   update from the Chrome Web Store once live). No popup or background
   behaviour change vs 2.6.2.

#### Firefox
1. Install `js-eyes-firefox-v2.6.3.xpi` (or update from AMO once the
   listing is live).

---

## v2.6.2

> **Security hygiene release — zero behavioural changes.** Responds to the
> [ClawHub v2.6.1 Security Scan](https://clawhub.ai/imjszhang/js-eyes) by
> splitting flagged call sites into dedicated single-responsibility modules,
> adding an opt-in integrity layer for `extraSkillDirs`, and documenting the
> remaining posture trade-offs. Wire protocol, CLI contract, default config
> values, and every public API are byte-for-byte compatible with 2.6.1.
> See [SECURITY_SCAN_NOTES.md](SECURITY_SCAN_NOTES.md) for the per-finding
> response matrix.

### Highlights

- **Shell / env / fs / network call sites decoupled** *(2026-04-24)*: The five
  static-analysis patterns flagged by ClawHub (shell exec, env + network,
  file read + network) are dissolved by extracting each operation into a
  small, purpose-built module: [`packages/protocol/safe-npm.js`](packages/protocol/safe-npm.js)
  owns the only `npm` invocation (whitelisted subcommand / argv / env,
  `shell:false`, `windowsHide:true`); [`packages/protocol/skill-runner.js`](packages/protocol/skill-runner.js)
  owns sub-skill CLI invocation (`process.execPath` only, no PATH lookup,
  `shell:false`, `windowsHide:true`); [`packages/protocol/openclaw-paths.js`](packages/protocol/openclaw-paths.js)
  owns env-based path resolution; [`packages/protocol/fs-io.js`](packages/protocol/fs-io.js)
  owns JSON / fs helpers; [`packages/protocol/registry-client.js`](packages/protocol/registry-client.js)
  owns every `fetch(…)` against the skill registry so network I/O is never
  co-located with `fs.readFileSync` / `createReadStream`;
  [`openclaw-plugin/auth.mjs`](openclaw-plugin/auth.mjs) owns token reading +
  header construction; [`openclaw-plugin/fs-utils/hash.mjs`](openclaw-plugin/fs-utils/hash.mjs)
  streams SHA1 hashes with `createReadStream`; and
  [`openclaw-plugin/windows-hide-patch.mjs`](openclaw-plugin/windows-hide-patch.mjs)
  isolates the Windows-only `child_process` patch (no-op on POSIX).
  `test/import-boundaries.test.js` prohibits these modules from importing
  `ws` / `http` / `https` / `net` — the invariant is enforced by CI, and
  `npm run scan:security` reproduces the ClawHub heuristic locally with an
  allowlist of three documented residual `spawnSync` callsites.
- **Optional integrity snapshots for `extraSkillDirs`** *(2026-04-24)*: New
  config key `security.verifyExtraSkillDirs` (default **off**). When enabled,
  `js-eyes skills link` writes a per-file sha256 map to
  `~/.js-eyes/state/extras/<sha1(absPath)>.json` (outside the external dir);
  `SkillRegistry` refuses to load an extra whose snapshot drifted and points
  the operator at a new `js-eyes skills relink <abs-path>` command. `doctor`
  reports the live integrity state per extra. Closes the "extraSkillDirs
  bypass integrity verification" concern raised by the OpenClaw review.
- **`js-eyes doctor --json`** *(2026-04-24)*: Emits the full security posture
  as a single JSON document (token source, security config, loopback state,
  per-skill integrity, policy snapshot) for auditors and CI. The human-readable
  text output is byte-identical to 2.6.1.
- **Local native-host launcher** *(2026-04-24)*: New scripts
  [`bin/js-eyes-native-host-install.sh`](bin/js-eyes-native-host-install.sh) and
  [`bin/js-eyes-native-host-install.ps1`](bin/js-eyes-native-host-install.ps1)
  wrap `node apps/cli/bin/js-eyes.js native-host install` — zero network, zero
  `npx`. `SKILL.md` and `docs/native-messaging.md` now recommend the local
  launcher as the preferred path; `npx` remains a documented fallback.
- **New documentation**: [`SECURITY_SCAN_NOTES.md`](SECURITY_SCAN_NOTES.md)
  (per-finding response matrix), README **Security Posture** table, SKILL.md
  **Safe Default Mode** section (capability envelope when
  `allowRawEval=false`).
- **CLI 子进程长尾修复** _(2026-04-25, 2.6.2 内补丁)_: `openclaw js-eyes status` / `tabs` / `server stop` 等一次性查询命令在 OpenClaw 子进程里跑完业务后会挂着不退出（chokidar `configWatcher` + `skillDirWatcher` 和 `skillRegistry` 持有 inotify/FSEvents handle 钉住 event loop），单次留下 ~50–100 MB 残留。在 [`openclaw-plugin/index.mjs`](openclaw-plugin/index.mjs) 模块顶层新增 `async exitCli(success)` helper（先 `await currentRegistration.teardown({})` 关掉 watchers / skillRegistry / WS bot，再 `setTimeout(() => process.exit(), 100).unref()` 兜底强退）和 `installCliExitHandlers()`（`uncaughtException` / `unhandledRejection` 全局兜底，仅在 `api.registerCli` 回调里调用一次，不污染 Gateway 进程）；三个一次性 CLI handler 末尾按成功/失败分别调 `await exitCli(true/false)`。**严格保持 `serverCmd.command("start")` 不动** — 它是预期永不退出的 daemon。`registerService` / `registerTool` / chokidar 整体设计 / `_lastHashByPath` Map 全部原样。实测 CLI 退出时间从"长尾几十秒至分钟级"降到 ~2.6s（绝大部分是 plugin 冷启 skill 加载），`[js-eyes] Service stopped` 日志确认 teardown 触发。复用 js-moltbook 那次实战验证过的 pattern。Affects [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs).

### Migration Notes

- **No breaking changes.** Every default is identical to 2.6.1; every public
  symbol keeps its prior module path (via re-exports where the source moved).
- **No config migration required.** `security.verifyExtraSkillDirs` defaults
  to `false` — existing `extraSkillDirs` users see no difference on upgrade.
- **Scope clarification**: this release is code + documentation only. Release
  artifact signing (cosign / minisign), SBOM emission, CI supply-chain
  scanners, and ClawHub-side registry metadata fixes are out of scope and are
  tracked for 2.7.
- **Upgrade path**: `js-eyes skills update js-eyes` or reinstall the parent
  bundle. No gateway restart is required beyond the usual plugin-module
  reload rule; skill-level edits stay zero-restart.

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.2/js-eyes-chrome-v2.6.2.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.2/js-eyes-firefox-v2.6.2.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.6.2/js-eyes-skill-v2.6.2.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.6.2`
2. `js-eyes doctor --json` — new machine-readable posture snapshot; the text
   output of `js-eyes doctor` is unchanged from 2.6.1.

#### OpenClaw
1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.6.2 and run `npm install`
   in the bundle root.
2. Restart OpenClaw once so the plugin module reloads. Subsequent
   `js-eyes skills link/unlink/reload/relink` remain zero-restart.
3. Optional hardening: merge `{ "security": { "verifyExtraSkillDirs": true } }`
   into `~/.js-eyes/config/config.json` and then re-run
   `js-eyes skills link <abs-path>` for every entry in `extraSkillDirs` to
   seed the integrity snapshot.

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.6.2.zip`, extract, reload unpacked (or update
   from the Chrome Web Store once live). No popup or background behaviour
   change vs 2.6.1.

#### Firefox
1. Install `js-eyes-firefox-v2.6.2.xpi` (or update from AMO once the listing
   is live).

---

## v2.6.1

> Memory-leak bugfix release for the long-running OpenClaw host (`ai.openclaw.gateway`). Fixes listener / fd / resource accumulation caused by hot-reload and repeated plugin registration. No breaking changes.

### Highlights

- **`MaxListenersExceededWarning` + `process.on('exit')` listener leak fixed** _(2026-04-24)_: `BrowserAutomation` no longer attaches per-instance `SIGINT` / `SIGTERM` / `exit` listeners — a module-level `Set` of active instances is now driven by a single set of process hooks installed via `_installProcessHooksOnce()`. The same fix applies to all 7 `skills/*/lib/js-eyes-client.js` copies. `skills/js-x-ops-skill/lib/xUtils.js` guards its own `process.on('exit')` with a `Symbol.for('js-eyes.skills.x-ops.xUtils.exitHook.v1')` flag so re-requires after a `require.cache` purge no longer stack duplicate exit callbacks. Affects [packages/client-sdk/index.js](packages/client-sdk/index.js), [skills/*/lib/js-eyes-client.js](skills), [skills/js-x-ops-skill/lib/xUtils.js](skills/js-x-ops-skill/lib/xUtils.js).
- **`openclaw-plugin#register()` is now idempotent** _(2026-04-24)_: Re-entering `register()` (e.g. after a skill toggle or config edit) previously rebuilt a fresh `SkillRegistry`, chokidar watchers, WebSocket server, and `BrowserAutomation` while the old ones kept running — causing port bind races, leaked fds, and phantom reload storms. `register()` is now `async` and guards a module-level `currentRegistration` singleton: on re-entry it `await`s a deterministic `teardownRegistration(ctx)` (`reloadTimer → configWatcher → skillDirWatcher → skillRegistry.disposeAll() → bot.disconnect() → server.stop()`) before wiring the new instance. The `registerService({ id: "js-eyes-server" }).stop()` path routes through the same teardown and only nulls the singleton when its `api` identity matches the current one. Affects [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs).
- **Skill hot-reload now disposes adapters and detects real content changes** _(2026-04-24)_: `SkillRegistry._reloadCore` used to decide "changed vs. unchanged" from `sourcePath`/`skillDir` only, so edits to `skill.contract.js` that kept the same path were ignored and old adapters piled up in memory with live WebSockets + intervals. A new `computeSkillFingerprint(skillDir)` (mtime + size of `skill.contract.js` and `package.json`) is now stored on skill state and compared on every reload; the contract-level `runtime.dispose()` is called before the old module is evicted from `require.cache`, with a warn-level invariant assertion and a `Purged N cached module(s)` info log when purge actually runs. Every skill that opens a `BrowserAutomation` (`js-browser-ops`, `js-jike-ops`, `js-reddit-ops`, `js-wechat-ops`, `js-x-ops`, `js-xiaohongshu-ops`, `js-zhihu-ops`) gained a `dispose()` that drains the bot and nulls the handle. Affects [packages/protocol/skill-registry.js](packages/protocol/skill-registry.js), [skills/*/skill.contract.js](skills).
- **Chokidar noise no longer triggers phantom reloads** _(2026-04-24)_: Editor atomic-writes, `.DS_Store` churn, and swap files on macOS used to fire `config-watch` / `skills-dir-watch` events that cascaded into full `SkillRegistry.reload()` calls. The plugin now ignores `.DS_Store`, `.git/`, `*.swp|swo|swx`, and `*~` at the watcher layer, and layers a sha1 content-hash gate (`scheduleReloadIfChanged(reason, filePath)`) so reloads only fire when the watched file's bytes actually changed. `runDiscover` also deduplicates `invalidExtraSkillDir` / skill-conflict warnings via per-registry `Set`s to stop log spam on repeated reloads. Affects [openclaw-plugin/index.mjs](openclaw-plugin/index.mjs), [packages/protocol/skill-registry.js](packages/protocol/skill-registry.js).

### Migration Notes

- **No breaking changes.** Wire protocol, CLI contract, and all public APIs are unchanged from 2.6.0.
- **Sub-skill patch bumps**: `js-browser-ops` `2.1.0 → 2.1.1`; `js-jike-ops` / `js-reddit-ops` / `js-wechat-ops` / `js-x-ops` / `js-xiaohongshu-ops` / `js-zhihu-ops` `2.0.0 → 2.0.1`. `js-bilibili-ops` and `js-youtube-ops` are untouched. Per the 2.6.0 decoupling, these sub-skill patches are independent of the parent bump.
- **Long-running gateway operators**: after upgrading, restart the gateway process once so the freshly-imported plugin module installs the single-shot `process.on` hooks. Subsequent skill changes remain zero-restart.
- **Upgrade path**: Reinstall the parent bundle, or run `js-eyes skills update --all` to pull the patched sub-skills. `docs/skills.json` in this release lists `minParentVersion: 2.6.1` as the safe default for sub-skills that don't declare their own floor — the builder always backfills the current parent version.

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.1/js-eyes-chrome-v2.6.1.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.1/js-eyes-firefox-v2.6.1.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.6.1/js-eyes-skill-v2.6.1.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.6.1`
2. `js-eyes doctor` — output should be unchanged from 2.6.0 aside from the new version strings.

#### OpenClaw
1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.6.1 and run `npm install` in the bundle root.
2. Restart OpenClaw **once** so the updated plugin module is re-imported — this is what installs the single-shot `process.on` hooks and wipes the old per-instance listeners. After that first restart, `js-eyes skills link/unlink/reload` stay zero-restart.
3. `js-eyes skills update --all --dry-run` — optional rehearsal; then drop `--dry-run` to pull the patched sub-skills.

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.6.1.zip`, extract, reload unpacked (or update from the Chrome Web Store once live). No popup or background behavior change vs 2.6.0.

#### Firefox
1. Install `js-eyes-firefox-v2.6.1.xpi` (or update from AMO once the listing is live).

---

## v2.6.0

> Sub-skill independent upgrade release. Sub-skills under `skills/*` now ship their own version channel — users on an older parent `js-eyes` skill can pull just the sub-skills they care about without reinstalling the whole bundle. No breaking changes.

### Highlights

- **Sub-skill independent upgrade channel** _(2026-04-21)_: Every sub-skill under `skills/*` tracks its own `package.json#version`, decoupled from the parent `js-eyes` version (`npm run bump` intentionally skips `skills/*`). New CLI command `js-eyes skills update <skillId|--all> [--dry-run] [--allow-postinstall]` reuses the existing `planSkillInstall` / `applySkillInstall` pipeline, preserves `skillsEnabled.<id>`, and refuses to cross a `minParentVersion` gap (exit code `2`). The gate compares the registry entry's `minParentVersion` against the **client's** installed parent version (read from `apps/cli/package.json#version`), not the registry snapshot's `parentSkill.version`. Affects [apps/cli/src/cli.js](apps/cli/src/cli.js); see [CHANGELOG.md](CHANGELOG.md) for the full change surface.
- **`install.sh` learns version-aware upgrades** _(2026-04-21)_: `install.sh` (and its mirror at [docs/install.sh](docs/install.sh)) now compares the local sub-skill's `package.json` version against the registry, prints `up to date` when they match, and upgrades in place (no `Overwrite?` prompt) when the registry is newer. `curl -fsSL https://js-eyes.com/install.sh | JS_EYES_SKILL=<id> bash` upgrades a single skill; `JS_EYES_SKILL=all` iterates every installed primary-source sub-skill. The shell path mirrors the CLI's `minParentVersion` gate by reading the local parent version from `${JS_EYES_ROOT}/package.json`.
- **Richer `docs/skills.json` entries** _(2026-04-21)_: Each sub-skill now carries `minParentVersion`, `releasedAt`, and `changelogUrl`. Sub-skill authors can declare their parent floor via `package.json#jsEyes.minParentVersion` or `peerDependencies["js-eyes"]`; `packages/devtools/lib/builder.js` backfills `releasedAt` from the sub-skill directory's latest git commit time and points `changelogUrl` at the sub-skill's `CHANGELOG.md` on GitHub when present. Older clients that parse `skills.json` see these as unknown optional fields and keep working.
- **`skills list` surfaces update hints** _(2026-04-21)_: `js-eyes skills list` now prints `Update available: <local> -> <registry> (run: js-eyes skills update <id>)` for outdated primary-source skills, and exposes `updateAvailable` / `latestVersion` in the `--json` payload so other tooling can plumb it into dashboards.

### Migration Notes

- **No breaking changes.** Wire protocol, CLI contract, existing `install.sh` flags, and the `skills install/approve/uninstall` flows are all unchanged. The new registry fields are additive and optional.
- **Upgrade path**: Upgrade the parent `js-eyes` skill to 2.6.0 (normal install) to pick up the new `skills update` command and the richer `skills list` output.
- **`minParentVersion` activates now**: Once 2.6.0 is live, future sub-skill releases can set `minParentVersion: "2.6.0"` (or higher) in their `package.json#jsEyes.minParentVersion` to give old parents a clear `BLOCKED (requires parent js-eyes >= ...)` message instead of a broken install. Sub-skills that don't declare a floor continue to install on any parent the registry still advertises — the builder fills the field with the current parent version as a safe default.
- **Sub-skill versions are not synced by `bump`**: When releasing the parent, `npm run bump -- <x.y.z>` updates `package.json`, CLI, plugin, extensions, and i18n badges — but **never** `skills/*/package.json`. That's the whole premise of the independent upgrade channel. Bump a sub-skill by editing its own `package.json` and running `npm run build:site`.

### Downloads

- [npm CLI (`js-eyes`)](https://www.npmjs.com/package/js-eyes)
- [npm scope (`@js-eyes/*`)](https://www.npmjs.com/org/js-eyes)
- [Chrome Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.0/js-eyes-chrome-v2.6.0.zip)
- [Firefox Extension](https://github.com/imjszhang/js-eyes/releases/download/v2.6.0/js-eyes-firefox-v2.6.0.xpi)
- [Skill Bundle](https://github.com/imjszhang/js-eyes/releases/download/v2.6.0/js-eyes-skill-v2.6.0.zip)

### Installation Instructions

#### npm CLI
1. `npm install -g js-eyes@2.6.0`
2. `js-eyes skills list` — verify the output now includes `Update available: ...` hints for any outdated primary-source skills (empty list is fine; nothing is out of date at first install).
3. `js-eyes skills update --all --dry-run` — non-mutating rehearsal: should print per-skill `already up to date` / `upgrading ...` / `BLOCKED ...` lines without touching the filesystem.

#### OpenClaw
1. Upgrade the `js-eyes` bundle (CLI + plugin) to 2.6.0 and run `npm install` in the bundle root.
2. Restart OpenClaw **once** so the updated CLI is picked up. From that point on, sub-skill upgrades happen via `js-eyes skills update <id>` or `JS_EYES_SKILL=<id> bash` — no further OpenClaw restart needed (the main plugin hot-reloads sub-skills via the existing chokidar watcher).

#### Chrome / Edge
1. Download `js-eyes-chrome-v2.6.0.zip`, extract, reload unpacked (or update from the Chrome Web Store once live). No popup or background behavior change vs 2.5.2.

#### Firefox
1. Install `js-eyes-firefox-v2.6.0.xpi` (or update from AMO once the listing is live).

---

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
