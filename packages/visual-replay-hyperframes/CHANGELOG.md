# @js-eyes/visual-replay-hyperframes — Changelog

记录 reddit/通用模板与 timeline 渲染层的语义变更。每条都尽量解释"为什么改"
而不是只列改了什么。

> 渲染端遵循 post-2.7.0 architecture pivot：composition 不再依赖 PNG / 帧序列 /
> 绝对像素坐标。模板只吃 `events.jsonl` 里的结构化 `payload`，任何"卡片渲不全"
> 的根因都要先回到上游 skill 的 `lib/visualHint.js::extractPayload`，模板侧只做
> "字段缺失也别难看"的兜底。
>
> v0.5.0 起 snapshot mode 重新启用 PNG/JPEG 截图作为 #stage 背景；模板路径
> 仍保留作为 events 无 `frame` 事件时的自动退化路径。
>
> v0.6.0 起把 reddit chrome / page-header / dom_* 合成动画 / scaffold CLI 等
> 在 snapshot 主链路下走不到的代码全部砍掉，回到"snapshot 优先 + 最小模板兜底"。
>
> v0.7.0 起把 HUD/flash 从硬编码改成 plugin 系统；v0.7.1 起 CLI 不再接受
> `--effects=hud,flash` / `--all-effects`（避免与 `--plugin` 混淆），改用显式 `--plugin=@builtin/*`。

---

## [0.7.2] - 2026-05-04

### Breaking — Reddit `list` / `item` 模板迁出引擎包

站点/技能专属 HTML 卡片不再放在 `packages/visual-replay-hyperframes/templates/reddit/`。
引擎只保留 `templates/_generic` + `templates/registry`。Reddit 卡片现由 **`js-reddit-ops-skill/replay-templates/`** 分发，并在 `translate()` 开始时通过 **template bootstrap** 注册。

- **`translate(opts)`** 新增 `opts.templateBootstrap`（入口 `.js`，副作用 `register`）
- **探测顺序**：`opts.templateBootstrap` → 环境变量 `JSE_REPLAY_TEMPLATE_BOOTSTRAP` → `<sessionDir>/../../replay-templates/index.js`（适用于 `<skill>/runs/<sess>/` 布局）
- **`jse-replay`**：`--template-bootstrap <path>`（`=path` 同义）

仅依赖已发布的 `@js-eyes/visual-replay-hyperframes`、且会话不在上述目录布局内的调用方，需显式传入 bootstrap 路径或环境变量，否则 `list`/`item` 会落到 `_generic` 兜底卡。

---

## [0.7.1] - 2026-05-04

### Breaking — CLI：`--effects` 不再承载 hud/flash/all

`--effects` 与 `--plugin` 双轨容易造成「我到底在开默认 builtin 还是在开某条 effect？」的混淆。
v0.7.1 收紧 CLI：**`--effects` 仅保留 `auto`（默认）与 `none`（同 `--no-effects`）**，用于 mode-aware 默认 builtin 的全局开关；具体要叠合成端 HUD/flash 一律走 `--plugin=@builtin/hud` / `--plugin=@builtin/flash`。

- **移除**：`--effects=hud` / `flash` / `hud,flash` / `all` → exit 1，提示改用 `--plugin`
- **移除**：`--all-effects` → exit 2（parse 阶段），提示改用两个 `--plugin=@builtin/*`
- **保留**：`--effects=cursor|typing|...` 仍报 `unknown effect`（v0.6.0 hard-error）
- **不变**：`translate()` 程序化 API 仍可传 `opts.effects: { hud: true, flash: true }`（与 `opts.plugins` 合并），仅 CLI 收紧

- **`cli/jse-replay.js`**：`validateCompositionEffects()` 取代 `expandEffects()`；删 deprecation warning 分支；help 与 file header 同步
- **`lib/translator.js`**：`replay-summary.json` 的 `architecture` 字段改为 `plugin-system (v0.7.1)`
- **`package.json`**：`0.7.0 → 0.7.1`

### Migration

| 旧命令 | 新命令 |
|---|---|
| `jse-replay sess --effects=hud,flash` | `jse-replay sess --plugin=@builtin/hud --plugin=@builtin/flash` |
| `jse-replay sess --all-effects` | 同上 |
| `jse-replay sess --effects=hud` | `jse-replay sess --plugin=@builtin/hud` |

### Verified

| 场景 | 命令 | 预期 |
|---|---|---|
| `--effects=hud` 已拒绝 | `jse-replay sess --effects=hud --no-render` | exit 1，stderr 提示 `--plugin=@builtin/hud` |
| snapshot 上显式 builtin | `jse-replay sess --plugin=@builtin/hud --plugin=@builtin/flash --no-render --keep` | plugins=两个 builtin |
| 其余 0.7.0 验收（默认 snapshot/template、spotlight、local plugin） | 同 0.7.0 | 行为不变 |

---

## [0.7.0] - 2026-05-04

### Added — Plugin system + reference spotlight + local plugin loading

把 `--effects=hud,flash` 这个封闭 enum 升级成 plugin 系统，落地两层价值：

- **架构层**：HUD / flash 从硬编码（`lib/hudClips.js` + 三段 timelineScript / styleEmbed）抽成两个 reference plugin；新增 plugin host 暴露 5 个 hook
- **用户层**：交付 `@js-eyes/spotlight`（消费已录制的 `dom_locate.rect` 数据画聚光灯）+ 一个 5 行的 local plugin fixture，作者照抄即可写出自己的效果

**新文件：**

- `lib/pluginHost.js` — 注册 / 解析 / 调 hook 核心；`@builtin/*` + `@js-eyes/*` + 本地路径解析
- `lib/pluginContext.js` — 只读 ctx 工厂（session / timeline / composition / config / logger）
- `plugins/builtin-hud/{index.js, style.js}` — 移植 `lib/hudClips.js` + `timelineScript` HUD 段
- `plugins/builtin-flash/{index.js, style.js}` — 移植 `timelineScript` flash + relation `addClassByAnchor` 段
- `plugins/community/spotlight/{index.js, style.js, README.md}` — 消费 `timeline.dom.locate.rect` 画聚光灯
- `plugins/README.md` — Plugin 接口契约 + 教学
- `__fixtures__/sample-local-plugin.js` — 最小 local plugin 例子（贴水印 + 一行字幕）

**Plugin 接口（同步 pure function，5 hooks）：**

```js
{
  name: '@me/my-effect',
  version: '0.1.0',
  injectHead?(ctx)        → string,                     // <head>
  injectBody?(ctx)        → string,                     // <body> 顶部
  injectTimeline?(ctx)    → string,                     // GSAP IIFE 末尾
  collectAssets?(ctx)     → Array<{from, to}>,          // 拷贝静态资源
  contributeSummary?(ctx) → object,                     // 写到 replay-summary
}
```

**CLI 用法：**

```bash
jse-replay <sess> --plugin=@js-eyes/spotlight
jse-replay <sess> --plugin=./my-watermark.js
jse-replay <sess> --plugin=@builtin/hud --plugin=@js-eyes/spotlight \
  --plugin-config '@js-eyes/spotlight={"radius":120,"tone":"orange"}'
```

### Changed — HUD / flash 移到 plugin

- `lib/translator.js`：删 `require('./hudClips')`，新增 `require('./pluginHost')` + `require('./pluginContext')`；`buildHtml` 不再硬调 `renderHudClips`，改用 plugin host 收集 `head/body/timeline` 字符串拼到 final HTML；`replay-summary.json` 新增 `plugins` / `pluginContributions` / `pluginAssets`，`architecture` 改为 `'plugin-system (v0.7.0)'`
- `lib/timelineScript.js`：删 `// ---- HUD ----` 整段（`tl.fromTo("#hud-...")` ~12 行）+ `// ---- Flash ----` 整段（`addClassByAnchor` + relation 处理 ~22 行）；保留 `addClassByAnchor` / `removeClassByAnchor` helper（plugin 端复用）；末尾留 `pluginTimeline` 注入点
- `lib/styleEmbed.js`：删 `.jse-hud` / `.flash-active` / `@keyframes jse-flash-pulse*` 共 ~14 行 CSS（已搬到对应 plugin/style.js）；保留核心 `#stage` snapshot stage + `.reddit-card*` / `.reddit-info-card`
- `cli/jse-replay.js`：新增 `--plugin <id>`（可重复）+ `--plugin-config '<id>={...}'`（必须是合法 JSON object）；`--effects=hud,flash` 内部 alias 成 `--plugin=@builtin/hud --plugin=@builtin/flash` + stderr deprecation warning；help 加「Plugin system」段

### Deprecated（v0.7.0 当时；CLI 已在 v0.7.1 移除 alias）

- ~~`--effects=hud / flash / hud,flash / all`：CLI 曾自动展开为 `--plugin=@builtin/*` + deprecation warning~~ → **v0.7.1**：CLI 拒绝这些 token，必须用 `--plugin`

### Removed

- `lib/hudClips.js`：内容移到 `plugins/builtin-hud/index.js`

### Behavior

- `snapshot mode 默认`：plugins=[]（"录制 = 干净"），与 0.6.0 视觉 1:1 一致
- `template mode 默认`：plugins=[`@builtin/hud`, `@builtin/flash`]（CLI 自动 append），与 0.6.0 视觉 1:1 一致
- `--effects=cursor|typing|click|ripple|spinner|scroll|shell` 仍然 hard-error（v0.6.0 已立的不动）
- `--shell / --no-shell / --frames-debug / --width / --height` 仍然 hard-error（v0.6.0 已立的不动）

### Migration（v0.7.0；CLI 细节以 v0.7.1 为准）

- ~~用户用过 `--effects=hud,flash`：能继续 work~~ → **v0.7.1** 必须用 `--plugin=@builtin/*`
- 想用新效果：`--plugin=@js-eyes/spotlight` 立即可用，或写自己的 plugin 用本地路径 `--plugin=./my.js` 加载
- SDK 用户调用 `translate(sessionDir, outDir, opts)`：`opts.effects` 对象形仍兼容；`opts.plugins` 与 CLI 行为一致

### Verified

| 场景 | 命令 | 预期 |
|---|---|---|
| 零回归 - snapshot 默认 | `jse-replay sess-snapshot --no-render --keep` | mode=snapshot, plugins=[], 视觉与 0.6.0 完全一致（0 hud aside, 0 flash class） |
| 零回归 - template 默认 | `jse-replay sess-template --no-snapshot --no-render --keep` | mode=template, plugins=[`@builtin/hud`, `@builtin/flash`], hud asides ≥1, flash toggles ≥1 |
| snapshot 上显式 builtin（v0.7.1+） | `jse-replay sess --plugin=@builtin/hud --plugin=@builtin/flash --no-render --keep` | replay-summary `plugins=[@builtin/hud, @builtin/flash]` |
| spotlight opt-in | `jse-replay sess --plugin=@js-eyes/spotlight --no-render --keep` | composition 含 `<div id="jse-spotlight-overlay">`；timeline 出现 `setSpotlight` 调用 |
| 本地 plugin | `jse-replay sess --plugin=./__fixtures__/sample-local-plugin.js --no-render --keep` | composition 内嵌该 plugin 注入的水印 + 字幕节点 |

---

## [0.6.0] - 2026-05-04

### Removed — snapshot-only-prune（约删 1180 行）

snapshot mode 主链路实测一周后：真实截图序列对"在哪个网站、做什么动作"的叙事感已经
**远超**之前的 reddit chrome 仿真 + dom_* 合成动画。这一版把 snapshot 模式下走不到
的代码全部砍掉，回到"snapshot 优先 + 最小模板兜底"。

**整文件删除（5 个）：**

- `lib/shellLayout.js` — 111 行，reddit topbar/leftnav 仿真
- `templates/reddit/pageHeader.js` — 296 行，按 toolName 分发的 page header
- `templates/reddit/tree.js` — 102 行，评论树模板（snapshot 截图已含真树）
- `templates/reddit/global.js` — 31 行，KV 卡（用 `_generic/genericKv` 兜底替代）
- `templates/reddit/navigation.js` — 47 行，from→to 过场卡
- `cli/jse-template-scaffold.js` — 388 行，模板脚手架 CLI

**部分编辑：**

- `lib/timelineScript.js` 删 `// ---- v0.4.0 DOM-first 渲染 ----` 整段（cursor / typing /
  click / ripple / spinner / scroll 渲染分支共 ~120 行 + 函数定义 +
  `syncShellState` 函数），只保留 setStageBackground 双缓冲 cross-fade、HUD
  `tl.fromTo("#hud-...")`、flash `addClassByAnchor` 三段
- `lib/styleEmbed.js` 删 `.jse-cursor / .jse-click-ripple / .jse-spinner /
  .jse-typing-caret` 等 dom_* CSS、`.reddit-topbar / .reddit-leftnav /
  body[data-shell="reddit"]` 系列 reddit chrome CSS、`.reddit-page-header` page header
  CSS、`.reddit-comment-tree / .comment-node` tree CSS、`.reddit-nav-card` 过场卡 CSS
- `lib/translator.js` 删 `require('./shellLayout')` / `require('../templates/reddit/pageHeader')`、
  `buildRedditShell({ communities })` 调用、`renderPageHeader(ctx)` 调用、`--shell` flag
  处理（`shellPolicy / shellEnabled`）；`normalizeEffects` 只留 `hud / flash` 两键；
  `replay-summary.json` schema 删 `shellPolicy / cardCount / missingTemplates` 等字段；
  `architecture` 字段从 `'snapshot-mode (v0.5.0)'` 改为 `'snapshot-only-prune (v0.6.0)'`
- `templates/reddit/index.js` 只保留 `register(SKILL_ID, 'list' | 'item', ...)` +
  对应 `('*', kind)` 兜底；删 `tree / global / navigation / write` 6 行 register
- `templates/_generic/index.js` 显式 register `('*', 'tree' | 'global' | 'navigation' | 'write')`
  → `genericKv`，让删掉的 reddit 模板有兜底（避免命中 legacy-global 时 missing）
- `cli/jse-replay.js` 删 `--shell / --no-shell`；新增 `validateEffects()` 把
  `--effects=cursor|typing|click|ripple|spinner|scroll|shell` 命中 → throw
  `unknown effect: <name>` (exit 1)；删 deprecated `--frames-debug / --width / --height`；
  help 文本同步精简
- `package.json` `version: "0.5.2" → "0.6.0"`；`bin` 删 `jse-template-scaffold`

### Breaking

- `--shell` / `--no-shell` 不再识别（CLI 报"未知参数"）。snapshot 模式截图自带
  chrome；template 模式直接渲卡片。
- `--effects=cursor|typing|click|ripple|spinner|scroll|shell` 现报
  `unknown effect: <name>` 退出 1。CLI 仅认 `auto / none / all / hud / flash`。
- `hint.kind=tree / global / navigation / write` 走 `_generic/genericKv` 兜底
  （视觉与 0.5.x 不一致：旧版有评论树 / KV info-card / from→to 过场卡专属布局；
  现在统一用 KV 兜底）。
- `replay-summary.json` 不再写 `shellPolicy / cardCount` 字段（保留
  `frameCount / framesCopied / snapshotMode / effects / templateUsage`）。

### Migration

- 想要 v0.5.x 完整体验（reddit chrome / page header / dom_* 动画）→ pin 到 0.5.2
- 用 `register()` 接 skill 模板的代码不变；scaffold CLI 用户需迁移到手写 register
- `--snapshot=auto --effects=auto` 默认行为**完全不变**：events 含 frame → snapshot
  + 干净录制；events 无 frame → 模板兜底（list/item 卡片 + HUD/flash 替代 chrome）

### Verified

| 场景 | 命令 | 预期 |
|---|---|---|
| snapshot 主链路 | `jse-replay sess-ai-self-evolution-snapshot --no-render` | duration / frame count / 视觉与 0.5.2 一致 |
| template 兜底 | `jse-replay sess-ai-self-evolution --no-render --no-snapshot` | reddit list / item 卡仍渲；tree/global/navigation 走 genericKv |
| 老 fixture v0.2.0 | `jse-replay __fixtures__/sess-reddit-list-html --no-render` | list 卡渲，shell 消失（接受） |
| 旧 effects flag 报错 | `jse-replay sess --effects=cursor` | exit 1，stderr `unknown effect: cursor (removed in v0.6.0; ...)` |
| HUD opt-in 仍可用 | `jse-replay sess --effects=hud` | composition 多 N 个 `<aside id="hud-...">` |

---

## [0.5.2] - 2026-05-04

### Changed — snapshot 模式默认不**额外**叠 HUD/flash overlay

> 设计澄清（一度搞错过一次）：
>
> 用户反馈"录屏右上角还有额外的渲染状态"——这里"额外"是关键词。**bridge 端的 in-page
> HUD pill / flash outline 是给人观察 agent 实时行为的反馈，应该原样保留**；它会随
> `captureScreenshot` 一起被拍进 PNG/JPEG 像素，那是**预期**的录制结果。
>
> 我们不希望的是合成端 (`visual-replay-hyperframes`) 拿到这些已经带 HUD 的截图后
> **再额外叠一层 composition-side HUD/flash**——那才是"额外"，会变成画面里两个 HUD
> 互相重叠 / flash 边框打两次的视觉冗余。

把 `hud` / `flash` 也纳入 `effects` gate（**只控制合成端**，不影响 bridge 录制时的
浮层）：

- **snapshot 模式默认**：`effects = { hud: false, flash: false, ... 全 false }` →
  composition 不再额外画 HUD `<aside>` / 不再 `addClassByAnchor("flash-active")`，
  替代地只显示 stage 上的 PNG/JPEG 帧（帧里**自然带着** bridge 当时画的 HUD/flash
  像素）+ 底部 footer 水印。
- **template 模式默认**：`effects = { hud: true, flash: true }`（其它仍 false）
  → 没有截图可以"借显"，必须由 composition 来画 HUD/flash，跟 v0.4.0 看起来一样，
  老 session 重渲零回归。
- **任意时刻可显式覆盖**：`--effects=hud` 把 HUD 强制加回（snapshot 模式下会叠在
  截图本身的 HUD 上面，**通常不需要**）；`--effects=all` 等价 v0.4.0 完整体验；
  `--effects=none` 强制 0 effects（即使 template 模式也压住 HUD）。

CLI `--effects` 默认值由 `'none'` 改为 `'auto'`（mode-aware）。

- **`lib/translator.js`** `DEFAULT_EFFECTS` / `normalizeEffects` 新增 `hud` / `flash`
  键；`translate()` 在 `o.effects === undefined || === 'auto'` 时按 `snapshotMode`
  分发默认值；`buildHtml()` 在 `effects.hud === false` 时跳过 `renderHudClips()`，
  HTML 完全不输出 `<aside class="jse-hud">` 节点。
- **`lib/timelineScript.js`** HUD 那段 `tl.fromTo("#hud-...")` tween 用 `if (effects.hud)`
  包住；flash + relation 的 `addClassByAnchor` 也用 `if (effects.flash)` 包住。
  对应的 `effects` 对象同步加 `hud: !!effectsCfg.hud, flash: !!effectsCfg.flash`，
  console log 也跟着多两个键，方便调试时一眼看清当前 gate。
- **`cli/jse-replay.js`** `--effects` 默认 `'auto'`；help doc 写明 mode-aware 行为。

### Verified

`bash`：

```sh
# snapshot mode 默认（应为 0 HUD aside）
node packages/visual-replay-hyperframes/cli/jse-replay.js \
  skills/js-reddit-ops-skill/runs/sess-ai-self-evolution-snapshot \
  --no-render --keep-composition
grep -c 'id="hud-' .../composition/index.html  # → 0

# template mode 默认（零回归，应为 20 HUD aside）
node packages/visual-replay-hyperframes/cli/jse-replay.js \
  skills/js-reddit-ops-skill/runs/sess-ai-self-evolution \
  --no-render --keep-composition
grep -c 'id="hud-' .../composition/index.html  # → 20

# 显式 --effects=hud 覆盖
node ... sess-ai-self-evolution-snapshot --effects=hud --no-render --keep-composition
grep -c 'id="hud-' .../composition/index.html  # → 58
```

浏览器实测 `http://localhost:8765/index.html`（snapshot 默认）：右上角不再出现状态卡，
只剩底部 footer 水印 `jse-replay · js-reddit-ops-skill · sess-... · v0.5 snapshot`，
画面就是真实的 reddit 截图序列。

---

## [0.5.1] - 2026-05-04

### Fixed — snapshot 合成开屏黑屏（SyntaxError + 首帧延迟）

v0.5.0 渲染出来的 `composition/index.html` 在浏览器里直接打开"什么都看不到"。

**根因 1：JS SyntaxError**。`timelineScript.js` 末尾那条 `console.log("[jse-replay]
timeline registered ...")` 把 `JSON.stringify(effects)`（含未转义的 `"`) 直接拼进
外层 `"..."` 字符串，浏览器报 `Uncaught SyntaxError: missing ) after argument list`，
整个 IIFE 直接阻断，timeline 从来没注册过、`tl.play()` 从来没跑过。修法：把整条
log 文本先在 Node 端拼好再 `JSON.stringify(__logMsg)` 一次性序列化成合法字面量，
不再担心 payload 内引号撕裂外层字符串。

**根因 2：首帧延迟黑屏**。即便 SyntaxError 修了，timeline 默认 `paused: true`，要
等 `setTimeout 800ms` 才 `tl.play()`，再加上第一帧 `tStart` 通常 > 0（这次是
0.407s），用户在前 ~1.2s 看到的是纯黑 `#0e1116`。修法：HTML 同步内联一段把
`frames[0]` 的 `background-image` 立刻种到 `.jse-frame-img-cur`，并用 `tl.set` 在
t=0 处把 `.jse-frame-img-next` 透明度复位，使得 timeline `repeat -1` 回到 0 时也
不会闪一次空白。

- **`lib/timelineScript.js`** snapshot mode 分支：
  - 修 `console.log` 拼接（用 `JSON.stringify(__logMsg)` 包整条）。
  - 新增"首帧 seed"块：`if (__frameCur) __frameCur.style.backgroundImage = ...` 同步
    把第一帧种进 cur 图层，外加 `tl.set("#stage .jse-frame-img-next", { opacity: 0 }, 0)`
    保证 loop 回 0 时 next 不残留前一帧。

### Verified

`bash`：

```sh
node packages/visual-replay-hyperframes/cli/jse-replay.js \
  skills/js-reddit-ops-skill/runs/sess-ai-self-evolution-snapshot \
  --no-render --keep-composition
python3 -m http.server 8765 \
  --directory skills/js-reddit-ops-skill/runs/sess-ai-self-evolution-snapshot/composition
```

浏览器 `http://localhost:8765/index.html` 现在：page-load 即刻显示第一帧 reddit 截图，
console 里 `[jse-replay] timeline registered ... frames=51 ...` 正常打印，800ms 后
`standalone mode: starting loop playback`，cross-fade 切到下一帧。

无 `Uncaught SyntaxError`，无回归。

---

## [0.5.0] - 2026-05-04

### Added — snapshot mode 主链路（PNG/JPEG #stage 背景） + effects gate

引入"视觉模式三档"：snapshot / template / enhanced（详见 README "视觉模式"）。
events.jsonl 含 `frame` 事件时，translator 自动走 snapshot 模式：把 PNG 序列
`cp` 到 `composition/frames/`，#stage 用双缓冲 cross-fade 220ms 切图，HUD +
flash 仍叠在上层；老 session 自动退模板（零回归）。

- **`lib/timeline.js`** `buildTimeline` 新增 `clips.frames[]` 收集 `frame`
  事件（tStart / tEnd / frameRef / viewport / linkedDomEvent / when），
  `clips.toolSegments[]` 跟踪每段 toolName 是否含 frame，给后续 shell 分段
  渲染提供数据。返回值新增 `frameCount` 真实计数。
- **`lib/timelineScript.js`** 新增 `setStageBackground(url, viewport)` 双缓冲
  cross-fade（cur + next 两层 div，opacity transition），按时间轴顺序切图；
  其余 dom_* 渲染分支（cursor / typing / click / ripple / spinner / scroll）
  全部用 `if (effects.<key>)` 包住，**默认 none 不冗余**，`--effects=all`
  等价 v0.4.0 行为。
- **`lib/styleEmbed.js`** 加 `#stage[data-mode="snapshot"]` + `.jse-frame-img-cur`
  / `.jse-frame-img-next` CSS（绝对定位 + transition opacity 220ms）；
  `body[data-shell="reddit"][data-frames="present"]` 隐藏 chrome（dom 段全 PNG），
  `data-frames="absent"` 时正常显示 reddit shell（template / api fallback 段兜底）。
- **`lib/translator.js`** 新增决策逻辑：
  - 检测 `tl.clips.frames.length > 0` → `mode="snapshot"`，否则 `mode="template"`
  - snapshot 模式 `fs.copyFileSync` 把 `<sess>/frames/*.{jpg,png,webp}` 拷到
    `<sess>/composition/frames/`
  - 接收 `--effects` / `--shell` / `--snapshot` opts，贯穿到 buildHtml +
    timelineScript
- **`cli/jse-replay.js`** 加：
  - `--snapshot <auto|always|never>` 默认 auto
  - `--shell <auto|always|never|fallback-only>` 默认 fallback-only
  - `--effects <none|cursor|typing|click|ripple|spinner|scroll|all>` 默认 none
  - `--no-effects` / `--all-effects` / `--no-shell` / `--no-snapshot` 速记
  - 输出 stderr 多打 `mode:`、`frames:`、`effects:` 三行便于调试
- **`replay-summary.json`** 新增 `frameCount` / `framesCopied` / `snapshotMode` /
  `shellPolicy` / `effects` 字段。

### Migration

- 没改输入约定。老 fixture（v0.2.0/0.3.0/0.4.0）直接走模板路径 1:1 视觉等价。
- `--no-render --keep-composition` 推荐做 PR 验证：composition.html 直接打开
  浏览器即可看到 reddit 真实截图序列 + HUD + flash。
- 想完全复刻 v0.4.0 视觉：`--all-effects --shell=always`。
- 验证："frame events 数 ≥ 30 / session 总尺寸 < 50 MB / dom 段 chrome 已隐 /
  api fallback 段 chrome 显出"。

---

## [0.4.0] - 2026-05-03

### Added — DOM 事件渲染（cursor / typing / click ripple / spinner / scroll）

`js-reddit-ops-skill` v3.7.0 引入 `--mode dom|auto` 之后，events.jsonl 里多了
一类 `dom_*` 事件——记录 DOM 桥真实在前台做的操作（`dom_navigate` /
`dom_locate` / `dom_hover` / `dom_click` / `dom_type` / `dom_typed` /
`dom_scroll` / `dom_wait` / `dom_extract`）。0.4.0 让 timeline 把它们渲成
离线 composition 上肉眼可见的鼠标 / 打字机 / 波纹 / spinner / 平移：

- **`lib/timeline.js`** `buildTimeline` 加 `clips.dom = { navigate, wait,
  locate, hover, click, type, typed, scroll, extract }` 收集器。`dom_type`
  字符事件按"连续同 selector 段"聚合成 typing run（避免每字渲一帧 GSAP 设置
  压垮渲染），其余事件按时序原样累积
- **`lib/timelineScript.js`** 新增渲染分支：
  - `dom_locate / dom_hover / dom_click` → `.jse-cursor`（fixed div）通过
    GSAP `tl.to(...)` 平滑移到 rect 中心；click 时 `spawnRipple(rect)` 生
    `.jse-click-ripple` 600ms 波纹
  - `dom_type` typing run → 调 `setShellSearchValue(text, cursor)` 把 shell
    topbar 输入框 value 逐字 set（与 syncShellState 兼容）
  - `dom_wait` → `spawnSpinner(rect)` + 等 duration 后 `removeSpinner()`
  - `dom_scroll` → 主 `#stage` `gsap.to({ y: deltaY })` 短暂偏移再回弹
- **`lib/styleEmbed.js`** 加 `.jse-cursor` / `.jse-click-ripple` /
  `.jse-spinner` / `.jse-typing-caret` 样式 + `jse-ripple` / `jse-spin` /
  `jse-blink` keyframes
- **`lib/translator.js`** 把 `tl.clips.dom` 透到 `buildHtml` /
  `buildTimelineScript`

### Compatibility

老 session（0.3.0 / 0.2.0 录的 API-only events.jsonl）重渲：`clips.dom` 全空
→ 所有新增渲染分支 noop → 行为完全等同 0.3.0。**零回归**实测：
v0.3.0 录的 sess-ai-self-evolution-final 14 张卡用 v0.4.0 重渲，HUD / flash /
cards / shell 全部 1:1 一致。

### Verified

`runs/sess-ai-self-evolution-dom`（v3.7.0 + v0.4.0 录制 + 重渲 14 步深度
调研）：
- duration 583.7s / hud 50 / flash 99 / cards 25 / data items 79
- events.jsonl 含 `dom_navigate` 10、`dom_type` 75、`dom_typed` 6、
  `dom_locate` 16、`dom_wait` 11、`dom_extract` 7
- composition 离线播放：连续 cursor 轨迹 + 6 个 search 命令的逐字打字效果

---

## [0.3.0] - 2026-05-03

### Added — reddit page shell（页面外壳）

之前 0.2.0 的 composition 视觉是「一组风格化数据卡轮播」——卡片本身完整、信息
密度高，但缺少"在哪个网站、做什么动作"的叙事感。看到的是抽象的"reddit 调色数据
卡片秀"，而不是"在 reddit 上做调研"。这一版把架构从「N 张独立卡」升级成「常驻
chrome + 主区按 timeline 切换不同 reddit 页面」：

- **新增 `lib/shellLayout.js`**：`buildRedditShell({ communities })` 输出常驻
  topbar + leftnav 的 HTML 字符串。
  - topbar 含风格化 reddit logo（**inline SVG，不直接拷商标**：橙红 #d93900 圆 +
    白色加粗 "r"）+ 全宽 search input（`[data-shell-search]`，timelineScript 在
    search 卡 active 时填 query）+ Create 按钮 + 用户头像占位
  - leftnav 240px 左栏分两段：
    - **Feeds**：固定 Home / Popular / All（仅装饰）
    - **Communities**：从本会话 events.jsonl 扫出的 sub 列表（按首次出现顺序、
      去重，最多 12 条），timelineScript 当前 active card 对应的 sub 自动高亮
  - 整套 chrome 跨所有卡片常驻，不参与切卡动画
- **新增 `templates/reddit/pageHeader.js`**：`renderPageHeader(ctx)` 按
  `ctx.toolName` 分发渲染每张卡片专属的 page header：
  - `reddit_search`：搜索结果 banner（query 大字 + N results · scope 副标）+
    type filter pills（Posts/Comments/Communities/People，默认 Posts active）+
    sort pills（Relevance/Hot/Top/New/Comments，按 payload.sort 高亮）
  - `reddit_subreddit_about`：sub banner（彩色圆 + r/<sub> + Joined 按钮 +
    "About community" 徽章）+ meta-pill（subscribers / Public）
  - `reddit_list_subreddit`：sub banner + sort tabs（Hot/New/Top/Rising，按
    payload.sort 高亮）
  - `reddit_user_profile`：user banner + tab bar（overview/posts/comments/saved）
  - `reddit_session_state`：user dropdown 展开态（绿点 + Logged in as +
    u/<username> + karma）
  - `reddit_inbox_list` / `reddit_my_feed`：banner + tab bar
  - `reddit_navigate_*`：breadcrumb（from URL → to URL）
  - 其他工具或非 reddit skill：返回空字符串（不渲 page header，进 stage 主体）
- **改 `lib/translator.js`**：
  - `buildCards()` 扫一遍 timeline 收集 `communities`（去重的 sub 名按首次出现
    顺序）连带返回；并给每张卡 wrap 注入 page-header + 设 `data-page-type` /
    `data-page-meta`（JSON 字符串，含 `{ sub, sort, query, feed, box }`）
  - `buildHtml()` 在 `<main id="stage">` 外面包一层 `<div id="reddit-shell">`，
    前面 prepend topbar + leftnav。`<body data-shell="reddit">` 标记打开 chrome
    样式（reddit 之外的 skill 自动跳过 shell，body 上写 `data-shell="none"`）
- **改 `lib/timelineScript.js`**：每张卡入场同时刻调 `syncShellState(cardEl)`：
  读卡片 `data-page-type` + `data-page-meta`，更新 `[data-shell-search]` input
  value（search 卡填 query，其他卡留空 placeholder）+ leftnav 当前 sub 高亮 +
  leftnav 当前 feed 高亮。`window.__jseSyncShellState` 暴露给外层做调试 / 自动化
- **改 `lib/styleEmbed.js`**：新增约 60 条 CSS 规则（`body[data-shell="reddit"]`
  作用域，零回归非 reddit skill）：
  - `#reddit-shell` grid layout：56px topbar + 240px leftnav + 主区
  - `.reddit-topbar` sticky 顶栏样式（圆角 search input、focus 蓝边、悬浮态、
    用户头像）
  - `.reddit-leftnav` 浅灰边 + 分段 + 当前 active 项左侧橙色色条
  - `.reddit-page-header` 各档：search banner / sub banner / sub-list sort
    tabs / user banner / nav breadcrumb / user dropdown
  - `.sort-tabs .pill.active` 高亮态（橙色边 + 浅橙背景）
  - `.card-stage` 适应 shell 主区收紧到 `max-width: 880px`
  - 响应式：< 900px leftnav 自动隐藏；< 600px 头像名隐藏

### 老 session 兼容

- v0.2.0 写出来的 `events.jsonl` 不需要重录就能用 v0.3.0 重渲——shell / page-header
  完全是渲染层叠加，不改 events 结构，不改模板 ctx，不改 timeline track 字段
- 实测：把 sess-ai-self-evolution-final（v0.2.0 录的）用 v0.3.0 重渲：14 张卡
  full shell + page-header，77 个 flash 全部命中（tier=exact），missingTemplates=[]，
  durationSec / cardCount / hudCount / flashCount 与 v0.2.0 重渲一致

### Tradeoffs

- **风格化而非商标**：reddit 配色 / 圆形头像 / 圆角 search 是 reddit 风，但 logo
  是简化 SVG（不直接拷 reddit 商标 / 不抓 reddit 真实图片）；用 system font 而
  非 reddit Sans
- **shell 仅对 reddit-ops 启用**：`buildHtml` 用 `skillId.includes('reddit')`
  判断启用，其他 skill 走 `data-shell="none"` 老路径，避免给非 reddit 模板加
  无意义的 chrome
- **不依赖 DOM 实测**：保持 post-2.7.0 离线 composition 优势——无 PNG / 无字体
  外链 / 无图片 baking / 无网络回环；shell 全部内联

---

## [0.2.0] - 2026-05-03

### Added — 模板冷启动（PR 2）

之前的失败兜底是渲一段死字 `<div class="empty-hint">no template / no payload</div>`：
任何没注册过的 `(skillId, kind)` 都会落到这里，整张卡片就一行字。给 reddit-ops
之外的新 skill 接入造成阻塞——必须在写出第一条 events.jsonl 之前就先把模板写好，
否则录像看着就是空的。这次给 hyperframes 加两条轨：

- **运行时兜底（`templates/_generic/`）**：
  - 新增 `templates/_generic/genericKv.js`：智能 renderer，根据 payload 形态选档位
    - `payload.items[]` 非空 → 渲"通用列表"，复用 `.reddit-card-list` 样式（最多 8 条；
      自动从 item 里抽 `title / id / url / subreddit / author / score / preview` 这些
      常见字段；缺什么字段就不渲什么）
    - `payload.fields[]` 非空 / `payload.summary` 字符串 → 渲 KV info-card，复用
      `.reddit-info-card` 样式
    - 三者皆空 → 折叠 `<details>` 显示 raw payload JSON（最多 4KB），右上角橙色
      badge `generic · <skillId>/<kind>` 标识"这是兜底，不是专属模板"
  - 新增 `templates/_generic/index.js`：注册 `('*', '*')` 终极档位
- **registry 查找链 5 档化**：`templates/registry.js`
  - `getTemplate(sid, k)` 链：`(sid, k) → ('*', k) → (sid, '*') → ('*', '*') → ('*', 'global')`
  - 返回值新增 `matchTier` 字段（`exact / kind-wildcard / skill-wildcard / generic /
    legacy-global`），上层 translator 能精确判断"这卡是不是走兜底了"
  - 新增 `findUnknownKinds(pairs)`：给 scaffold CLI 用，过滤出走兜底的二元组
- **translator 诊断输出**：`lib/translator.js`
  - `buildCards` 返回 `{cards, templateUsage}`，每张卡都记 `{skillId, kind, tier}`
  - `replay-summary.json` 新增两个字段：`templateUsage` 全量 + `missingTemplates`
    聚合（按 count 倒序）；CI 可读这个字段决定是否提醒"补模板"
- **scaffold CLI**：`cli/jse-template-scaffold.js`
  - 用法：`jse-template-scaffold <session-dir> [--out <dir>] [--skill <id>] [--dry-run]`
  - 行为：
    1. 扫 events.jsonl 抽 `(skillId, kind)` 二元组 + 抽样 ≤8 条 payload
    2. 调 `findUnknownKinds` 过滤出未专属注册的
    3. 浅扫推断 payload shape（顶层 keys / `items[0]` keys / `fields[].k` 集合 +
       每个键观察到的 type 集合）
    4. 按 shape 选骨架风格（list / kv / raw），写出 `<out>/<skill>/<kind>.js` +
       `<out>/<skill>/index.js`（自动 `register` 调用）
    5. 骨架文件含 TODO 注释列出所有推断字段，作者 `mv` 到 `templates/<skill>` 后
       照着补 reddit 风格的 HTML
  - dry-run 模式只打印计划，不写盘
- **README**：新增"为新 skill 制作模板（v0.2.0 模板冷启动）"章节，详记三条轨道的
  组合用法。模板 API 文档同步：`kind` 类型从枚举放宽到 `string`，`getTemplate` 增
  `matchTier` 返回值，新增 `findUnknownKinds` 签名。

### Changed

- `package.json` 版本 `0.1.1` → `0.2.0`（minor：新增 `('*','*')` 兜底档位 + scaffold
  CLI；既有 `register` API、`replay-summary.json` 既有字段都向前兼容）
- `package.json` `bin` 加 `jse-template-scaffold`
- `lib/translator.js` 顶部 require 顺序：先 `_generic` 再 `reddit`，让任何卡片都至少
  有兜底（虽然 registry 查找链按优先级，无关 require 先后，但顺序写明意图）

### Notes

- 老 session 重渲行为完全不变（reddit 已注册全部 kind，仍走 `exact` / `kind-wildcard`
  档；`templateUsage` 显示 `tier=exact`）
- 新增 `('*', '*')` 不影响现有 reddit 已注册的 `('*', list/item/...)`：后者更专 kind
  优先级更高
- scaffold CLI 写的是骨架，**不替作者判断"哪些字段是主数据"**（比如 sub-about 的
  hero metric 需要人工挑），骨架先保证能跑、能渲，后续打磨样式
- 在 reddit `runs/sess-ai-self-evolution` 上验过：scaffold dry-run 输出 "all kinds
  registered. Nothing to scaffold."，重渲 `templateUsage` 全部走 `exact`，零回归
- 在手工 fixture（`kind=stats / table` 未注册）上验过：未注册 kind 渲出 generic
  KV / list 卡 + 橙色 badge，不再出现 `no template / no payload`；scaffold 产出 3
  个文件（`stats.js / table.js / index.js`），mv 进去后 require + 调 `getTemplate`
  返回 `tier=exact`，渲染语法正确

## [0.1.1] - 2026-05-03

### Fixed

- `templates/reddit/list.js` 的 sub-title 在 `payload.sub` 为空时（典型场景：reddit
  全站 search、`pickListing` 没识别出 sub 的列表）会硬编码成 `'reddit'`，导致同一
  composition 里几张全站 search 卡片标题完全一样，无法区分。
  - 修复：sub-title 兜底链改为 `r/<sub>` → `payload.label` → `ctx.label` →
    `ctx.hint.label` → `'reddit'`，这样 reddit-ops bridge 给出的 `label`（例如
    "搜索 ai self evolution"）会正常显示在标题位。
- `templates/reddit/item.js::renderInfoCard` 渲 sub-about / session-state 这种
  "几个原子字段 + 一个标志性大数字"的信息卡时，所有字段都用同等大小的 `dt/dd`
  网格排列，订阅数 / activeUserCount 这种关键指标看不出来主次。
  - 修复：`renderInfoCard` 抽出 hero metric（匹配 `subscribers / subscriberCount /
    activeUserCount / totalKarma / num_comments / comment_count`），单独大字号渲
    在卡片顶部；其余字段照常进 kv-grid。
  - `lib/styleEmbed.js` 加配套 `.hero-metric / .hero-num / .hero-label` 样式
    （大字号、accent 色、底部分隔线）。

### Changed

- `package.json` 版本 `0.1.0` → `0.1.1`（patch：模板兜底 + 视觉增强，不破坏既
  有 composition 协议）。
- 老 session 包重渲即可看到 list 标题修复；info-card 的 hero metric 需要上游
  skill ≥ `js-reddit-ops-skill 3.6.2`（fields 里要先有 `subscribers` 这种字段
  名才能匹配到）。

### Notes

- 不修 `events.jsonl` schema，不动 `index.js` / `lib/translator.js`；仅模板与
  样式两层。
- 已在 `runs/sess-ai-self-evolution` 上重渲验证：list 标题不再死字 `reddit`；
  老 session 的 sub-about 卡因为 `payload.fields` 还是旧的 `[{k:'sub'}]`，不会
  自动恢复，需要在 skill 升级到 3.6.2 后重录一次。

---

## [0.1.0] - 2026-04 ~ 2026-05 早期

- post-2.7.0 architecture pivot 落地：从 PNG 帧序列改为 events.jsonl 结构化
  payload + HTML 模板渲染；引入 reddit / generic 模板族；HUD / progress / flash
  outline 按 vw / clamp 适配响应式；spawn `npx hyperframes` 输出 MP4。
- 详情见 `journal/2026-05-03/visual-replay-pivot-followup.md`。
