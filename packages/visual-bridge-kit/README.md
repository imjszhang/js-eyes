# @js-eyes/visual-bridge-kit

可复用的浏览器内"视觉反馈层" + 业务数据派发器，让 bridge 类技能（reddit-ops / x-ops / zhihu-ops … 以及外部 newidea-cli-test）共享同一套 HUD + flash overlay + 评论树关系线 + 结构化业务数据落盘 + 离线 HTML 模板回放。

## post-2.7.0 architecture pivot（重要）

> 主链路从"PNG 截图 + DOM 测量 + 离线坐标叠层" 切换为 "业务 payload + HTML 数据驱动模板"。
> kit 包版本 `0.4.x`（不动版本号），主链路换骨。
>
> | 维度 | 之前（PNG 路线） | 现在（A 路线 HTML） |
> |---|---|---|
> | events 内容 | `viewport / anchor.rect / frameRef` | `kind / payload / anchor.spec` |
> | 离线产物 | `frames/*.png` + 绝对坐标 flash 盒 | reddit-style HTML 卡片 + class 切换式 flash |
> | 视口耦合 | 1641×885 强写死，缩放后错位 | 响应式 vw/clamp，任意尺寸 0 错位 |
> | 入口 | `require('@js-eyes/visual-bridge-kit')` 顶层 export `makeFrameWriter` | 顶层不再有；改 `require('@js-eyes/visual-bridge-kit/dev')` |

PNG 路线代码保留（`node/captureFrame.js` + 顶层 dev 子路径），仅供历史 fixture 回归与 dev 调试。任何新接入都应该走 A 路线。

## 它解决的问题

- **运行时反馈**：bridge 仍在浏览器实时画 HUD + flash，让 agent 操作可见
- **业务数据派发**：`extractPayload` 钩子把工具响应的业务字段（reddit 帖子标题/作者/分数等）落到 `events.jsonl`
- **离线视频**：[`@js-eyes/visual-replay-hyperframes`](../visual-replay-hyperframes) 按 `hint.kind` 路由 HTML 模板，渲染成可在任意视口播放的 reddit-style 卡片
- **零业务侵入**：bridge 函数体不动，视觉与数据抽取都在 dispatch-edge hook
- **DOM 派 / API 派通吃**：`mode: 'auto'` 找得到 DOM 锚点就 in-page flash，找不到自动降级 HUD

## 三档反馈

| 强度 | 触发条件 | 表现 |
|---|---|---|
| **DOM-anchored** | hint 带 `anchor`，`resolveAnchor()` 命中可见元素 | flash 元素 + HUD |
| **HUD-only** | 解析不到锚点，或 `--visual-mode hud` | 屏幕角 HUD |
| **Trace-only** | `--no-visual`，但仍写 jsonl | 仅落盘 |

## 架构（A 主路：HTML 数据驱动）

```
┌─ Node ────────────────────────────────────────────────────────────────┐
│  parseVisualFlags(opts, siteDefaults?) ─► visualConfig                │
│      └ deprecatedFlags 检测 → CLI 层一次性告警                         │
│  makeBridgeExpander({baseDir}) ─► 处理 // @@include 行                 │
│  applyVisualConfig(session, cfg) ─► 下发到 page                       │
│  wrapCallApi(session, hint, fn, hooks)                                │
│      ├ buildSummary(resp, hint, err)                                  │
│      └ extractPayload(resp, hint, err) ★ 主链路                       │
│  drainVisualEvents(session) ─► 取 ring buffer（含 payload）            │
│  appendVisualSession(dir, entry, opts) ─► 会话包：events.jsonl + meta  │
└────────────────────────────────────────────────────────────────────────┘
                          │ summary.payload 透传
                          ▼  callRaw(...)
┌─ Page (bridge IIFE) ──────────────────────────────────────────────────┐
│  // @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js       │
│  // @@include ./_visual-<site>.js                                      │
│                                                                        │
│  window.__jse_visual = {                                               │
│    config / getConfig                                                  │
│    flashElement / flashRelation / showHud / announceStage              │
│    cleanup / drainEvents / emit                                        │
│    before(hint) / after(hint, summary) ─► emit({type, kind, payload})  │
│    resolveAnchor / staggerFlashItems   ← _visual-<site>.js 覆盖        │
│  }                                                                     │
└────────────────────────────────────────────────────────────────────────┘
                          │ events.jsonl
                          ▼
┌─ Offline replay ──────────────────────────────────────────────────────┐
│  @js-eyes/visual-replay-hyperframes (lib/translator.js)                │
│      └ readVisualSession(dir) → buildTimeline(entries)                 │
│        → for each (before/after) pair: getTemplate(skillId, kind)      │
│        → 渲 HTML reddit-style 卡片 → composition.html                  │
└────────────────────────────────────────────────────────────────────────┘
```

### B 备用路（dev / debug）：PNG 截图

```js
// 仅作 dev 调试 / 旧 fixture 回归
const { makeFrameWriter, attachFrameRefsToEvents } = require('@js-eyes/visual-bridge-kit/dev');

// 显式把 captureFrame 挂回 wrapCallApi（主链路不会自动调）：
const writer = makeFrameWriter({ recordDir, getTabId, captureScreenshot });
await wrapCallApi(session, hint, fn, {
  buildSummary,
  extractPayload,
  captureFrame: writer, // dev only
});
```

PNG 仍可生成，但 A 路线 translator 不消费它。

## 三步接入指南

> 假设你的 skill 目录是 `skills/js-<site>-ops-skill/`，bridge 文件在 `bridges/`。

### 1. 加 dep

```jsonc
// skills/js-<site>-ops-skill/package.json
{
  "dependencies": {
    "@js-eyes/visual-bridge-kit": "^0.1.0"
  }
}
```

### 2. 在 session.js 用通用 expandBridgeSource

```js
// skills/js-<site>-ops-skill/lib/session.js
const path = require('path');
const { makeBridgeExpander } = require('@js-eyes/visual-bridge-kit');

const expandBridgeSource = makeBridgeExpander({
  baseDir: path.join(__dirname, '..', 'bridges'),
});
```

### 3. 在 bridges/common.js 顶部加 include

```js
// skills/js-<site>-ops-skill/bridges/common.js
// @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js
// @@include ./_visual-<site>.js
```

> 这一行已经被 `// @@include ./common.js` 嵌入到每个 bridge 文件，所以只需写一次。

### 4. （站点专属）实现 anchor resolver

复制 `node_modules/@js-eyes/visual-bridge-kit/bridge/anchorResolver.template.js` 到 `bridges/_visual-<site>.js`，按站点 DOM 反查规则改写。reddit-ops 的实现参见 [skills/js-reddit-ops-skill/bridges/_visual-reddit.js](../../skills/js-reddit-ops-skill/bridges/_visual-reddit.js)。

### 5. 给每个工具写 visualHint

```js
// lib/visualHint.js
function getVisualHint(toolName, args, result){
  switch (toolName) {
    case 'site_get_post':
      return { kind: 'item', toolName, label: '读取帖子', anchor: args.id || null };
    case 'site_list_feed':
      return { kind: 'list', toolName, label: '抓取列表', anchor: null };
    default:
      return { kind: 'global', toolName, label: toolName };
  }
}
module.exports = { getVisualHint };
```

### 6. 在调度层包 wrapCallApi

```js
// lib/runTool.js
const { wrapCallApi, drainVisualEvents, appendVisualSession } = require('@js-eyes/visual-bridge-kit');
const { getVisualHint, buildSummary, extractPayload } = require('./visualHint');

const hint = getVisualHint(toolName, args);
const resp = await wrapCallApi(session, hint, async () => {
  return await session.callApi(method, [args]);
}, {
  buildSummary: (r) => buildSummary(r, hint),
  // ★ 主链路：把响应里的业务字段抽成 payload，下游 translator 按 hint.kind 路由 HTML 模板
  extractPayload: (r, h, e) => extractPayload(r, Object.assign({}, hint, { args }), e),
});

const events = await drainVisualEvents(session);
appendVisualSession(recordDir, {
  runId, skillId, toolName, args, hint, ok: resp.ok !== false, durationMs, events,
}, { skillId, skillVersion });
```

### 7. CLI 旋钮

```js
// lib/commands.js
function parseArgv(argv){
  // ...
  if (a === '--visual') opts.visual = true;
  else if (a === '--no-visual') opts.visual = false;
  else if (a === '--visual-detail') opts.visualDetail = argv[++i];
  else if (a === '--visual-ms') opts.visualMs = argv[++i];
  else if (a === '--visual-mode') opts.visualMode = argv[++i];
  else if (a === '--visual-trace') opts.visualTrace = argv[++i];
  else if (a === '--visual-list-stride') opts.visualListStride = argv[++i];
  else if (a === '--visual-prefix') opts.visualPrefix = argv[++i];
}

// 之后给到 parseVisualFlags 时可以传 siteDefaults，覆盖默认值（例如 prefix）：
// parseVisualFlags(opts, { prefix: '__jse_<site>_visual_' })
```

## CLI flag 速查

| flag | 默认 | 说明 |
|---|---|---|
| `--visual` / `--no-visual` | 开 | 总开关 |
| `--visual-detail compact\|staged` | `staged` | `compact` 只 HUD，`staged` 全套（含 relation） |
| `--visual-ms <n>` | `420` | flash 持续时长（ms） |
| `--visual-mode auto\|dom\|hud\|both\|off` | `auto` | 锚点解析策略 |
| `--visual-trace <file>` | — | 把事件落到 jsonl |
| `--visual-list-stride <ms>` | `90` | 列表呼吸感的步进 |
| `--visual-prefix <p>` | `__jse_visual_` | DOM id 前缀（站点可用 `siteDefaults` 改默认值） |

## visualHint schema

```ts
type Hint = {
  kind: 'item' | 'list' | 'tree' | 'global' | 'navigation' | 'write';
  toolName: string;
  label: string;
  anchor?: string | object | null;     // 任何 resolveAnchor 能识别的 spec
  target?: string;                      // HUD 副标题
  detail?: string;                      // HUD 第三行
  tone?: 'info' | 'pending' | 'success' | 'danger';
};

type Summary = {
  ok: boolean;
  items?: Array<anchorSpec>;            // kind:'list' 时 in-page stagger flash
  relate?: Array<{from, to, label}>;    // kind:'tree' 时画 in-page relation 线
  errorCode?: string;
  detail?: string;
  payload?: object | null;              // ★ post-2.7.0：业务数据载荷
};
```

## events.jsonl payload schema (post-2.7.0)

`meta.json` 标 `payloadSchemaVersion: 1`。每条 entry 的 `events[*]` 中，`type === 'after'` 的事件多带一个 `payload` 字段，由 `hint.kind` 决定 shape：

| hint.kind | payload shape |
|---|---|
| `list` | `{ items: [{id,title,author,subreddit,score,num_comments,...}], totalCount, sub, sort }` |
| `item` | 单条 item 的字段（id/title/author/score/...）；或 `{ summary, fields:[{k,v}] }` 兜底 |
| `tree` | `{ items: [...], relations: [{from,to,depth?}] }` |
| `global` | `{ summary: string, fields: [{k,v}] }` |
| `navigation` | `{ from, to, hint: 'page_will_reload', label }` |
| `write` | 走 `global` 兜底（首版未做精细抽取） |

## 安全护栏

- `pointer-events: none` 永远不拦 reddit/x/zhihu 自家点击；
- 默认不 `scrollIntoView`（虚拟滚动列表不友好），元素不在视口自动降级 HUD；
- z-index 取 `2147483000`，低于 newidea outline 的 `2147483646`，不挡 site 自家 dialog；
- ring buffer 上限 200 条，防止 page 长时间运行后内存堆积；
- SPA 路由变化（`pushState/replaceState/popstate`）自动 `cleanup()`。

## 版本

- `0.1.0` 起步：HUD + flash + relation + jsonl trace + auto/dom/hud/both/off mode + SPA 防御。
- `0.4.0` 与 server-core 2.7.0 同步：`appendVisualSession` 会话包目录形态、`makeFrameWriter` 顶层 export。
- `0.4.x` (post-2.7.0 architecture pivot)：emit 主链路下线 `viewport / anchor.rect / frameRef`；新增 `hooks.extractPayload` 钩子；`makeFrameWriter` 等 PNG helpers 迁到 `@js-eyes/visual-bridge-kit/dev` 子路径；`meta.json` 加 `payloadSchemaVersion: 1`，去掉 `redact / frameCount`。版本号不动。

## 许可

MIT
