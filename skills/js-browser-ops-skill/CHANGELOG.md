# Changelog

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
