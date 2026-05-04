# @js-eyes/visual-replay-hyperframes

把 `@js-eyes/visual-bridge-kit` 写出的会话包目录翻译成 [hyperframes](https://github.com/imjszhang/hyperframes) composition.html，并可一键 spawn `npx hyperframes render` 生成 mp4。

## 视觉模式（v0.6.0）

| mode | 触发条件 | 渲染产物 | 适用场景 |
|---|---|---|---|
| **snapshot** | events.jsonl 含 `frame` 事件 | `#stage` 双缓冲背景图（PNG/JPEG cross-fade） | dom-first agent 录制、真实 reddit 截图回放（主链路） |
| **template** | events 无 `frame`（老 session / `--no-snapshot`） | `_generic/genericKv` 兜底卡 + reddit `list/item` 卡片 | 数据驱动语义重渲、零截图带宽场景（fallback） |

CLI 默认（推荐）：`--snapshot=auto --effects=auto`

`--effects=auto` 是 mode-aware 默认；这个 gate 只决定**合成端要不要再画一层
overlay**，对 bridge 录制时画在浏览器里的 HUD/flash（已经被截进 JPEG 像素）没影响：

| events 含 frame？ | 默认 effects | 含义 |
| --- | --- | --- |
| 是（snapshot mode） | `{ hud: false, flash: false }` | 截图自带 bridge HUD/flash，合成端不再额外加一层；只显示 stage 上的 PNG/JPEG + 底部水印 |
| 否（template mode） | `{ hud: true, flash: true }` | 没有截图可"借显"，必须由 composition 来画 |

任意时刻可手动覆盖：`--effects=hud` / `--effects=flash` / `--effects=hud,flash` / `--no-effects`（强制 0 effects）。

> **Breaking from v0.5.x**：`--effects=cursor|typing|click|ripple|spinner|scroll|shell` 全部下线。
> snapshot 模式下这些动作已由真实截图序列承载；想要 v0.5.x 行为请用 0.5.2。

## post-2.7.0 architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  events.jsonl entry                                              │
│  { hint:{kind, label, anchor}, events:[                          │
│      { type:'before',  ... },                                    │
│      { type:'frame',   frameRef, viewport, ts },  ← snapshot 主链路│
│      { type:'flash',   ... },                                    │
│      { type:'after',   ... }                                     │
│  ] }                                                             │
└─────────────────────────────────────────────────────────────────┘
                          │  readVisualSession
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  buildTimeline(entries) → { hud, flash, relation, frames, ... } │
└─────────────────────────────────────────────────────────────────┘
                          │  按 (skillId, hint.kind) 路由
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  templates/registry.js                                           │
│  ├─ templates/reddit/{list,item}.js   （专属卡片）               │
│  └─ templates/_generic/genericKv.js   （tree/global/navigation/  │
│                                          write 与终极兜底）       │
└─────────────────────────────────────────────────────────────────┘
                          │  buildHtml + buildTimelineScript
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  composition.html                                                │
│  ├─ <main id="stage" data-mode="snapshot">                       │
│  │    ├─ .jse-frame-img-cur / .jse-frame-img-next  双缓冲背景图   │
│  │    └─ template 兜底时这里是 .reddit-card-list                  │
│  ├─ HUD overlay (opt-in)                                         │
│  ├─ flash class（opt-in，给卡片 add .flash-active）              │
│  ├─ <script> GSAP timeline                                       │
│  │    └─ tl.add(() => setStageBackground(url, viewport), t)      │
│  └─ <style> snapshot stage CSS + 卡片样式 + flash keyframes      │
└─────────────────────────────────────────────────────────────────┘
                          │  npx hyperframes render
                          ▼
                       replay.mp4
```

## 关键设计

### 1. snapshot 双缓冲 cross-fade

`#stage[data-mode="snapshot"]` 下两层 `.jse-frame-img-cur` + `.jse-frame-img-next`，
每个 `frame` 事件触发：next 先 fade-in（220ms ease）→ cur 切图 → next fade-out。
page-load 时立即把第一帧种到 cur 图层，timeline 还没 play 时就已可见，避免黑屏。

### 2. flash 不依赖 DOM 测量（opt-in）

`flash` event 只带 `anchor.spec`。HTML 模板里每张卡片 `data-anchor-id="t3_xxx"`。
`--effects=flash` 时 timelineScript 在 flash 时刻给目标节点临时 add `.flash-active` 类，
CSS keyframes 跑 outline + glow，结束 remove。视口任意尺寸下卡片自适应、flash 跟随，**0 错位**。

snapshot 模式下截图本身已经带了 bridge HUD/flash，默认不再合成端叠一层；template 模式下没截图可借显，默认开。

### 3. 模板驱动而非位图叠层（template mode 兜底）

`templates/registry.js` 提供 `getTemplate(skillId, kind) → renderer`。当前注册：

- `(js-reddit-ops-skill, 'list')` / `('*','list')` → `reddit/list.js`：8 张垂直 reddit post 卡片
- `(js-reddit-ops-skill, 'item')` / `('*','item')` → `reddit/item.js`：单 post 大卡片
- `('*','*')` / `('*','tree')` / `('*','global')` / `('*','navigation')` / `('*','write')` → `_generic/genericKv.js`：智能识别 payload（list / kv / raw）

接 x-ops / zhihu-ops 时只需 `register('js-x-ops-skill', 'list', renderer)` 即可。

## 使用

```bash
# 1. 跑 reddit 工具，产生会话包
node skills/js-reddit-ops-skill/cli/index.js list-subreddit MachineLearning \
  --visual --visual-record runs/pivot-list

# 2. 转译并预览 / 渲染
node packages/visual-replay-hyperframes/cli/jse-replay.js runs/pivot-list --no-render
node packages/visual-replay-hyperframes/cli/jse-replay.js runs/pivot-list --preview
node packages/visual-replay-hyperframes/cli/jse-replay.js runs/pivot-list --out demo.mp4

# 3. （可选）lint composition
npx hyperframes lint runs/pivot-list/composition/
```

## CLI flag

| flag | 说明 |
|---|---|
| `<session-dir>` | 必填，`--visual-record` 写出的目录 |
| `--out <file.mp4>` | 渲染输出路径（默认 `<session-dir>/replay.mp4`） |
| `--preview` | spawn `hyperframes preview` 而非 render |
| `--no-render` | 只生成 composition |
| `--keep-composition` | 渲染完保留中间产物 |
| `--title <s>` | composition 页面 title |
| `--skill <id>` | 显式指定 `skillId` 路由模板（默认从 meta.json 读） |
| `--snapshot <mode>` | `auto` (默认) \| `always` \| `never` |
| `--no-snapshot` | 等价 `--snapshot=never` |
| `--effects <list>` | `auto` (默认) \| `none` \| `all` \| `hud` \| `flash` \| `hud,flash` |
| `--no-effects` | 等价 `--effects=none` |
| `--all-effects` | 等价 `--effects=all`（hud + flash） |

### Removed in v0.6.0（会报错）

| flag | 说明 |
|---|---|
| `--shell` / `--no-shell` | reddit chrome 仿真已删；snapshot 模式截图自带 chrome |
| `--effects=cursor\|typing\|click\|ripple\|spinner\|scroll` | dom_* 合成动画已删，回退请用 0.5.2 |
| `--frames-debug` / `--width` / `--height` | 已 noop 多版 |

## 模板 API

```ts
// templates/registry.js
register(skillId: string | '*', kind: string,
         renderer: (ctx: TemplateContext) => string,
         opts?: { defaultClass?: string }): void;

type TemplateContext = {
  payload: object | null;
  anchorId: string;
  hint: { kind: string; label: string; target: string; skillId: string };
  label: string;
  target: string;
  tone: 'info' | 'success' | 'danger' | 'pending';
  eventIndex: number;
  sequence: { current: number; total: number };
  meta: { skillId: string };
};

// 路由查找链：
//   (sid, k) → ('*', k) → (sid, '*') → ('*', '*') → ('*', 'global')
// 返回 { renderer, defaultClass, matchTier }，matchTier 表示命中的档位。
getTemplate(skillId: string, kind: string): { renderer; defaultClass; matchTier } | null;
```

接新 skill 模板的最小例子：

```js
const { register } = require('@js-eyes/visual-replay-hyperframes/templates/registry');

register('js-x-ops-skill', 'list', (ctx) => {
  const items = (ctx.payload && ctx.payload.items) || [];
  const cards = items.slice(0, 8).map((it) => `
    <article class="x-tweet-card" data-anchor-id="${it.id}">
      <p>${escapeHtml(it.text)}</p>
      <footer>${it.author} · ❤ ${it.likes}</footer>
    </article>
  `).join('');
  return `<section class="x-stage" data-kind="list">${cards}</section>`;
});
```

> v0.5.0 起新 skill 录像不再依赖专属模板——snapshot 主链路直接用截图序列；template 兜底走 `_generic/genericKv` 智能识别 payload（list / kv / raw）。专属卡片仅作锦上添花。

## Fixtures

- [`__fixtures__/sess-reddit-list-html/`](__fixtures__/sess-reddit-list-html) — A 路线主链路 baseline（reddit list-subreddit，有 `payload`、无 `frames/`）。v0.6.0 重渲走 template 路径。
- [`__fixtures__/sess-firefox-2.7.0/`](__fixtures__/sess-firefox-2.7.0) — **archived** PNG-mode baseline，仅供 dev/debug 路径回归 `captureFrame.js`。

## 模块映射

| 文件 | 作用 |
|---|---|
| `lib/translator.js` | 主入口，`translate(sessionDir, outDir, opts)` |
| `lib/timeline.js` | events.jsonl → `{hud, flash, relation, frames, before, after}` |
| `lib/timelineScript.js` | 生成嵌入式 GSAP `<script>`（snapshot setStageBackground + opt-in HUD/flash） |
| `lib/styleEmbed.js` | snapshot stage CSS + 卡片样式 + flash keyframes |
| `lib/hudClips.js` | HUD `<aside>` HTML 片段 |
| `templates/registry.js` | (skillId, kind) → renderer 映射 + 5 档查找链 + `findUnknownKinds` |
| `templates/reddit/{list,item}.js` | reddit list / item 专属卡片模板（template mode 兜底用） |
| `templates/_generic/genericKv.js` | 终极兜底（`('*','*')` + tree/global/navigation/write 显式 register），智能渲 list/kv/raw |
| `cli/jse-replay.js` | CLI：translate + spawn hyperframes |

## 许可

MIT
