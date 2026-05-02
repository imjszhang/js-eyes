# @js-eyes/visual-bridge-kit

可复用的浏览器内"视觉反馈层"，让 bridge 类技能（reddit-ops / x-ops / zhihu-ops … 以及外部 newidea-cli-test）共享同一套 HUD + flash overlay + 评论树关系线 + jsonl 回放。

## 它解决的问题

- **演示效果**：让旁观者直观看到 agent 当前在操作哪个元素 / 哪条数据。
- **调试**：操作失败时屏幕上直接显示错误码，不必盯 stdout。
- **回放**：所有视觉事件落到 jsonl，CI 与无头模式也有可观测。
- **零业务侵入**：bridge 函数体不动，所有视觉副作用在调度边界。
- **DOM 派 / API 派通吃**：`mode: 'auto'` 找得到 DOM 锚点就 flash 它，找不到自动降级 HUD。

## 三档反馈

| 强度 | 触发条件 | 表现 |
|---|---|---|
| **DOM-anchored** | hint 带 `anchor`，`resolveAnchor()` 命中可见元素 | flash 元素 + HUD |
| **HUD-only** | 解析不到锚点，或 `--visual-mode hud` | 屏幕角 HUD |
| **Trace-only** | `--no-visual`，但仍写 jsonl | 仅落盘 |

## 架构

```
┌─ Node ────────────────────────────────────────────────────────────┐
│  parseVisualFlags(opts, siteDefaults?) ─► visualConfig             │
│  makeBridgeExpander({baseDir}) ─► 处理 // @@include 行              │
│  applyVisualConfig(session, cfg) ─► 下发到 page                    │
│  wrapCallApi(session, hint, fn) ─► before / after                  │
│  drainVisualEvents(session) ─────► 取 ring buffer                  │
│  appendVisualTrace(path, entry) ─► jsonl 落盘                      │
└────────────────────────────────────────────────────────────────────┘
                          │
                          ▼  callRaw(...)
┌─ Page (bridge IIFE) ──────────────────────────────────────────────┐
│  // @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js   │
│  // @@include ./_visual-<site>.js                                  │
│                                                                    │
│  window.__jse_visual = {                                           │
│    config / getConfig                                              │
│    flashElement / flashRelation / showHud / announceStage          │
│    cleanup / drainEvents / emit                                    │
│    before / after                                                  │
│    resolveAnchor / staggerFlashItems   ← _visual-<site>.js 覆盖    │
│  }                                                                 │
└────────────────────────────────────────────────────────────────────┘
```

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
const { wrapCallApi, drainVisualEvents, appendVisualTrace } = require('@js-eyes/visual-bridge-kit');
const { getVisualHint } = require('./visualHint');

const hint = getVisualHint(toolName, args, null);
const resp = await wrapCallApi(session, hint, async () => {
  return await session.callApi(method, [args]);
}, {
  buildSummary(resp){
    if (!resp || resp.ok === false) return { ok: false, errorCode: (resp && resp.error) || '' };
    const items = (resp.data && Array.isArray(resp.data.items))
      ? resp.data.items.map((it) => it.id || it.fullname).filter(Boolean)
      : [];
    return { ok: true, items };
  }
});

const events = await drainVisualEvents(session);
appendVisualTrace(visualConfig.tracePath, { toolName, events });
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
  items?: Array<anchorSpec>;            // kind:'list' 时 stagger flash
  relate?: Array<{from, to, label}>;    // kind:'tree' 时画 relation 线
  errorCode?: string;
  detail?: string;
};
```

## 安全护栏

- `pointer-events: none` 永远不拦 reddit/x/zhihu 自家点击；
- 默认不 `scrollIntoView`（虚拟滚动列表不友好），元素不在视口自动降级 HUD；
- z-index 取 `2147483000`，低于 newidea outline 的 `2147483646`，不挡 site 自家 dialog；
- ring buffer 上限 200 条，防止 page 长时间运行后内存堆积；
- SPA 路由变化（`pushState/replaceState/popstate`）自动 `cleanup()`。

## 版本

- `0.1.0` 起步：HUD + flash + relation + jsonl trace + auto/dom/hud/both/off mode + SPA 防御。
- `0.2.x` 计划：写操作的 `MutationObserver` 校正（`kind:'write'` + `expectAnchor`）。

## 许可

MIT
