# Changelog

## 2.5.1 — 2026-06-26

### Added

- `browser_read_page` 新增 `autoAllowDomain`（默认 `true`）：读取新 URL 前自动把
  目标域名写入 `security.egressAllowlist`，减少 `pending-egress` 打断。
- CLI `read` 子命令：`--allow-new-domain` / `--no-auto-allow-domain`。
- `ServerPolicyError`：策略拒绝时返回更清晰的错误信息。

## 2.5.0 — 2026-05-22

### Added

- `browser_screenshot` 现在调用扩展层 `capture_screenshot` RPC 返回真实截图
  dataUrl，而不是只返回页面/视口元数据。
- 新增 `fullPage` / `format` / `quality` 参数；Firefox active tab 支持
  `fullPage=true` 长截图，返回页面尺寸、视口尺寸与分片元数据。

### Fixed

- 长截图路径不再依赖 `html2canvas`、CDN 注入、`eval` 或页面内 canvas
  `toDataURL()`，避免 Firefox CSP / isolated world / 跨域污染问题。

## 2.4.0 — 2026-05-04

### BREAKING — visualMode 拆解（同 visual-bridge-kit@0.6.0）

- `--visual-mode auto|dom|hud|both|off` 拆成 `--visual-hud` / `--no-visual-hud` /
  `--visual-flash` / `--no-visual-flash`（默认都开）。旧 flag 仍解析，但 `parseVisualFlags`
  把它列入 `deprecatedFlags` 并 stderr 告警一次，不再下发到 bridge config。
- 旧值映射（caller 自行展开）：`auto`/`both` → 都开；`dom` → 关 hud；`hud` → 关 flash；
  `off` → `--no-visual`。

## 2.3.0 — 2026-05-02

### Added
- 接入 `@js-eyes/visual-bridge-kit@^0.4.0`，新增 Phase 2 录像支持：
  - `withVisual` 在 `--visual-record` 启用时自动构造 `captureFrame` 钩子，
    通过新加的 `BrowserAutomation.captureScreenshot` 拉 active tab 的 png
    dataUrl，落到 `<recordDir>/frames/<ts>.png`（fire-and-forget，节流 60 帧
    / 250ms）。非激活 tab 静默 skip。
  - `lib/cliVisualFlags.js` 新增 `--redact-rect "x,y,w,h"`、
    `--redact-selector <css>`、`--redact-config <file.json>` 三个旋钮；
    `resolveVisualOptions` 返回的 `visual.redact` 一路透传到
    `appendVisualSession`，写到 `meta.json` 的 `redact` 段，离线 replay
    端按这些区域贴马赛克。
  - `lib/api.js` 把 kit 返回的 `frames` 元数据塞进 trace entry 顶层，方便
    `@js-eyes/visual-replay-hyperframes` 的转译器读到。
- `lib/js-eyes-client.js` 新增 `captureScreenshot(tabId, options)`：
  `chrome.tabs.captureVisibleTab` 的 RPC 封装，返回
  `{ tabId, dataUrl?, format?, width?, height?, skipped?: 'tab_not_active' }`。

### Changed
- `package.json` 升 `@js-eyes/visual-bridge-kit` 到 `^0.4.0`，本 skill 版本 → 2.3.0。

### Notes
- 该录像档位需要 chrome extension `@>=2.7.0`：
  - 扩展端在 `allowedActions` 里加了 `capture_screenshot`；
  - 服务端 `@js-eyes/server-core` 加了 `capture_screenshot` 转发；
  - 用户必须重新加载扩展（chrome://extensions → 刷新）才能解锁此能力。

### Architecture pivot (post-2.7.0, in-place)

> **本 skill 跟随平台 post-2.7.0 architecture pivot 一起换骨：主视觉链路不再
> 走 PNG 截图 / DOM 坐标叠层。版本号不动（保持 `2.3.0`），依赖仍是
> `@js-eyes/visual-bridge-kit@^0.4.0`。**

#### Removed from main pipeline (代码保留, 主链路下线)
- `lib/api.js::withVisual` 不再 `import { makeFrameWriter }` 也不再构造
  `captureFrame` 钩子；改为只走 `wrapInjectCall`，`frames` 数组 / `redact`
  段 都不再透传给 `appendVisualSession` / `appendVisualTrace`。
  - `BrowserAutomation.captureScreenshot` RPC 仍然保留（`lib/js-eyes-client.js`
    未改）；如要继续生成 `frames/*.png` 用于 dev/debug 回归，请直接
    `require('@js-eyes/visual-bridge-kit/dev').makeFrameWriter` 自行装配
    `hooks.captureFrame`。
- `lib/cliVisualFlags.js`：
  - `--redact-rect / --redact-selector / --redact-config` 仍解析（不报错），
    但 `parseVisualFlags` 现在通过新加的 `deprecatedFlags` 字段标识它们。
  - 新加 `--visual-record-frames` / `--no-visual-record-frames` /
    `--visual-frames-throttle` 的解析（同样标 deprecated）。
  - 新加 `warnDeprecatedFlagsOnce(deprecatedFlags)`：第一次见到这些 flag
    时写一行 stderr 提示，引导到
    `require('@js-eyes/visual-bridge-kit/dev').makeFrameWriter`。
- `scripts/browser-read.js` / `scripts/browser-interact.js` 在
  `resolveVisualOptions` 之后调用 `warnDeprecatedFlagsOnce(visual.deprecatedFlags)`。

#### What still works
- 在线视觉反馈（HUD / flash 锚点 / 列表呼吸感）零变动 —— `withVisual` 仍把
  `wrapInjectCall` 接到 6 个工具的调度边界，浏览器里看 agent 在做什么完全不变。
- `--visual-record <dir>` 仍然写 `meta.json` + `events.jsonl`（不再写
  `frames/`）；`events.jsonl` 不再带 `viewport / anchor.rect / frameRef`。
- 离线 `@js-eyes/visual-replay-hyperframes` 翻译这套 session 时**还没注册
  `js-browser-ops-skill` 模板**（reddit 是首批），所以会落到 `'*'` 通配模板
  渲一个 HUD-only 的 fallback composition；`hyperframes lint` 通过，0 errors。
  专属模板（read / click / scroll / fill_form / wait_for / screenshot 的
  HTML 视觉演出）排在下一个 minor。
- `withVisual` 现在多了一个隐式钩子能力 `hooks.extractPayload`，本 skill
  暂未提供 `extractPayload` 实现（reddit 实现了完整一套），等专属模板上线时
  补 `lib/visualHint.js::extractPayload`。

#### Compatibility
- 已有的 2.7.0 PNG 模式会话包（`runs/.../frames/*.png` + 含 `anchor.rect`
  的 events.jsonl）仍能被新 translator 读懂，会优雅降级为"HUD-only +
  `cards: 1, totalDataItems: 0`" 的 composition；旧 fixture
  [`packages/visual-replay-hyperframes/__fixtures__/sess-firefox-2.7.0/`](../../packages/visual-replay-hyperframes/__fixtures__/sess-firefox-2.7.0/)
  保留，README 改标"PNG-mode archived baseline"。
- 没有 wire protocol / CLI 入口的 breaking change，所有在用脚本继续工作；
  唯一的体感变化是 stderr 多出一行 deprecation 警告（如果之前真的传过
  `--redact-*` / `--visual-record-frames`）。

## 2.2.0 — 2026-05-02

### Added
- 接入 `@js-eyes/visual-bridge-kit@^0.2.0`，6 个工具默认带页面内视觉反馈：
  HUD（右上角状态条）+ flash（锚点元素黄/绿框）+ jsonl trace。业务脚本
  生成器（`lib/browserUtils.js`）一行不改，符合 zero-touch 原则。
- 新增 CLI 旋钮（`browser-read.js` / `browser-interact.js` 都支持）：
  - `--visual` / `--no-visual`
  - `--visual-detail compact|staged`
  - `--visual-ms <n>`（120–4000，默认 420）
  - `--visual-mode auto|dom|hud|both|off`
  - `--visual-trace <file.jsonl>`
  - `--visual-list-stride <ms>`
  - `--visual-prefix <p>`（默认 `__jse_browser_visual_`，与 reddit-skill 隔离）
- 新增 `bridges/_visual-browser.js` — 通用 anchor resolver，覆盖
  `window.__jse_visual.setSiteAnchorResolver`，识别 CSS / XPath / text /
  URL / 对象式 spec。
- 新增 `lib/visualHint.js` — 6 个工具的 hint + 各自 `buildSummary`，
  解析 click/fill/wait/scroll/read/screenshot 的成功/失败状态写入 trace。
- 新增 `lib/cliVisualFlags.js` — `applyVisualArgs` / `resolveVisualOptions`
  双 helper，给两个 cli script 共用。

### Changed
- `lib/api.js` 6 个函数（readPage/clickElement/fillForm/waitFor/scrollPage/
  takeScreenshot）统一通过 `withVisual(toolName, browser, tabId, params,
  options, runScript)` 高阶函数走 `wrapInjectCall`。`options.visual` 缺失
  或 `enabled:false` 时直接 `runScript()`，零额外 RTT，调用路径与 2.1.1
  完全一致。

### Notes
- 每次工具调用开 visual 时 +2 RTT（before+install 合并、after+drain 合并）。
  `installVisualBridgeKit` 自带 `__installed` 短路锁，重复 inject 接近 0
  成本。
- chrome:// / file:// 等受限页 visual 注入静默失败，业务返回不受影响；
  trace 仍写空 events 行。
- `skill.contract.js` 不暴露 visual flag，server 端 openclaw 客户端走默认
  `enabled:true`，向后兼容。

## 2.1.1
- baseline。
