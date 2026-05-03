# @js-eyes/visual-replay-hyperframes

把 `@js-eyes/visual-bridge-kit` 写出的会话包目录翻译成 [hyperframes](https://github.com/imjszhang/hyperframes) composition.html，并可一键 spawn `npx hyperframes render` 生成 mp4。

## post-2.7.0 architecture pivot

> 本包从 PNG-叠层模式切换到 **HTML 数据驱动模板**。版本号不动，主链路换骨。

```
┌─────────────────────────────────────────────────────────────────┐
│  events.jsonl entry                                              │
│  { hint:{kind, label, anchor}, events:[                          │
│      { type:'before', kind, label, anchor, ts },                 │
│      { type:'flash',  tone, label, anchor, ts },                 │
│      { type:'after',  kind, ok, payload:{items,totalCount,...} } │
│  ] }                                                             │
└─────────────────────────────────────────────────────────────────┘
                          │  readVisualSession
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  buildTimeline(entries) → { hud, flash, relation, before, after }│
│  flash[i].anchorId = "t3_xxx" / "sub:foo" / ...                  │
└─────────────────────────────────────────────────────────────────┘
                          │  按 (skillId, hint.kind) 路由
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  templates/registry.js                                           │
│  └─ templates/reddit/{list,item,tree,global,navigation}.js       │
│  返回 HTML 片段（响应式 vw/clamp）                                │
└─────────────────────────────────────────────────────────────────┘
                          │  buildHtml + buildTimelineScript
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  composition.html                                                │
│  ├─ <main id="stage">                                            │
│  │    └─ reddit-style 卡片（每张 data-anchor-id="t3_xxx"）        │
│  ├─ HUD overlay (.jse-hud, position: fixed)                     │
│  ├─ <script> GSAP timeline                                       │
│  │    └─ tl.add(() => addClass('flash-active', anchorId), t)    │
│  └─ <style> reddit-style CSS + flash keyframes                  │
└─────────────────────────────────────────────────────────────────┘
                          │  npx hyperframes render
                          ▼
                       replay.mp4
```

## 关键设计

### 1. flash 不再依赖 DOM 测量

旧路径：`flash` event 携带 `{rect:{x,y,w,h}}`，translator 渲一个绝对定位的 `<div>` 浮在 PNG 上。换屏 / 缩放 / DOM 重排就错位。

新路径：`flash` event 只带 `anchor.spec`（如 `'t3_1t1lmq0'` / `'sub:MachineLearning'`）。HTML 模板里每张卡片 `data-anchor-id="t3_xxx"`。timelineScript 在 flash 时刻执行：

```js
tl.add(() => $('[data-anchor-id="t3_1t1lmq0"]').classList.add('flash-active'), t);
tl.add(() => $('[data-anchor-id="t3_1t1lmq0"]').classList.remove('flash-active'), t + 0.6);
```

CSS keyframes `jse-flash-pulse` 跑 outline + glow，视口任意尺寸下卡片自适应、flash 跟随，**0 错位**。

### 2. 模板驱动而非位图叠层

`templates/registry.js` 提供 `getTemplate(skillId, kind) → renderer`。Reddit 已注册 5 个 kind：

- `list` → 8 张垂直 reddit post 卡片
- `item` → 单 post 大卡片 / 兜底 info card
- `tree` → 评论树（`--depth` 缩进）
- `global` → key/value 字段卡（session-state / probe）
- `navigation` → from→to URL 过场卡

接 x-ops / zhihu-ops 时只需 `register('js-x-ops-skill', 'list', renderer)` 即可。模板是普通 Node 函数，输入 `{payload, hint, anchorId, label, target, tone}`，输出 HTML 字符串。

### 3. 响应式而非固定像素

不再有 `--width 1280 --height 720` 这种硬尺寸。所有卡片用 `max-width: 980px / clamp() / vw`，HUD 用 `position: fixed`，从手机到 4K 屏都不会错位。

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

### Deprecated（仍接受不再生效）

| flag | 替代 |
|---|---|
| `--frames-debug` | 不再有 frames track。如需 PNG 调试，自行 `require('@js-eyes/visual-bridge-kit/dev')` 挂 `makeFrameWriter` |
| `--width / --height` | composition 改用响应式 CSS |

## 模板 API

```ts
// templates/registry.js
register(skillId: string | '*', kind: string, // 任意字符串，建议用 'list'|'item'|'tree'|'global'|'navigation'|'write'
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

// 路由查找链（v0.2.0）：
//   (sid, k) → ('*', k) → (sid, '*') → ('*', '*') → ('*', 'global')
// 返回 { renderer, defaultClass, matchTier }，matchTier 表示命中的档位。
getTemplate(skillId: string, kind: string): { renderer; defaultClass; matchTier } | null;

// 给 scaffold CLI 用：返回那些只命中 generic / skill-wildcard / legacy-global 兜底的条目
findUnknownKinds(pairs: Array<{skillId, kind, count?}>): Array<{skillId, kind, count, tier}>;
```

接新 skill 模板的最小例子：

```js
const { register } = require('@js-eyes/visual-replay-hyperframes/templates/registry');

register('js-x-ops-skill', 'list', (ctx) => {
  const items = (ctx.payload && ctx.payload.items) || [];
  const cards = items.slice(0, 8).map((it) => `
    <article class="x-tweet-card flash-target" data-anchor-id="${it.id}">
      <p>${escapeHtml(it.text)}</p>
      <footer>${it.author} · ❤ ${it.likes}</footer>
    </article>
  `).join('');
  return `<section class="x-stage" data-kind="list">${cards}</section>`;
});
```

## 为新 skill 制作模板（v0.2.0「模板冷启动」）

录制时遇到一个还没专属模板的 `(skillId, kind)`，整个链路也不再阻塞或渲空：

1. **运行时兜底**：`templates/_generic/` 注册的 `('*', '*')` 终极兜底会智能识别 payload 形态——
   - 有 `items[]` → 渲成"通用列表卡"（复用 `.reddit-card-list` 样式）
   - 有 `fields[]` / `summary` → 渲成 KV info 卡
   - 都没有 → 渲 raw payload JSON（折叠 `<details>`），右上角 `generic · <skill>/<kind>` 橙色 badge 标识"未注册"
   - 替代了过去那段 `<div class="empty-hint">no template / no payload</div>`
2. **`replay-summary.json` 诊断**：每次 translate 后写出 `templateUsage`（每张卡命中的 tier）+ `missingTemplates`（命中兜底的聚合统计）。CI 可读这个字段决定是否提醒"补模板"。
3. **scaffold CLI 反推骨架**：

```bash
node packages/visual-replay-hyperframes/cli/jse-template-scaffold.js <session-dir> --dry-run

# 实际写出
node packages/visual-replay-hyperframes/cli/jse-template-scaffold.js <session-dir> \
  --out ./templates-scaffold

# review 后 mv 到 templates/
mv ./templates-scaffold/<skill> packages/visual-replay-hyperframes/templates/<skill>
# 在 lib/translator.js 里 require 一次
echo "require('../templates/<skill>');" # 加到 translator.js 顶部
```

scaffold 做的事：
- 扫 `events.jsonl` 抽出所有 `(skillId, kind)` 二元组及对应 `payload` 抽样
- 对那些走了 `generic / skill-wildcard / legacy-global` 兜底档位的，按 payload 形状（list / kv / raw）选模板风格
- 写出 `<skill>/<kind>.js`（含 TODO 注释列出推断字段）+ `<skill>/index.js`（自动 `register` 调用）
- 你只需在 `<skill>/<kind>.js` 里把字段渲成漂亮 HTML（参考 `templates/reddit/*`）

注意：scaffold 是一次性脚手架，**不替你判断"哪些字段是主数据"**——比如 sub-about 那种 hero metric（subscribers）需要人工挑出。骨架先保证能跑、能渲、看得到字段，后续打磨样式。

## DOM-first 事件渲染（v0.4.0）

v0.4.0 起 timeline 识别 `js-reddit-ops-skill` v3.7.0 的 `dom_*` 事件流（在 `--mode
dom|auto` 录像里出现），把它们转成离线 composition 上**真实的鼠标 / 打字 /
点击 / 滚动 / 等待**：

| 离线事件 | 渲染方式 |
|---|---|
| `dom_locate` / `dom_hover` / `dom_click` | `.jse-cursor` GSAP 移位 + `.jse-click-ripple` 600ms 波纹 |
| `dom_type`（连续字符聚合成 typing run） | shell topbar 的 `[data-shell-search]` 输入框逐字 set value，模拟打字机 |
| `dom_wait` | 在目标 rect 中心生 `.jse-spinner` 800ms loop spinner，wait 结束移除 |
| `dom_scroll` | 主 `#stage` `transform: translateY` 短暂偏移 |
| `dom_navigate` | 走 `syncShellState` 路径，URL bar 同步 |

新事件不破坏老 session 渲染：v0.3.0 录的 events.jsonl 走 v0.4.0 重渲时
`clips.dom` 全空，所有 dom 渲染分支 noop，行为完全等同 v0.3.0（**零回归**）。

新事件来源（仅 reddit-ops 当前支持）：

```bash
# DOM 优先（默认 auto = DOM 失败 fallback API）
node skills/js-reddit-ops-skill/cli/index.js search "self-evolution AI" \
  --mode auto --visual --visual-record runs/poc

# 强制 DOM 路径（CI / debug selector 漂移用 _dev-probe-dom.js）
node skills/js-reddit-ops-skill/cli/index.js list-subreddit MachineLearning \
  --mode dom --visual --visual-record runs/poc-dom-only

# 强制 API 路径（保留为兼容档）
... --mode api ...
```

## reddit page shell（v0.3.0「页面外壳」）

reddit-ops 录像不再是裸的"数据卡片秀"，而是包了一层**常驻 reddit chrome**——让
观众一眼就看出"这是在 reddit 上做调研"。

```
┌──────────────────────────────────────────────────┐
│ ⊙ reddit  [search input  填当前 query]    +Create user │ ← topbar (sticky)
├────────┬─────────────────────────────────────────┤
│ Feeds  │  ┌─────────────────────────────┐         │
│  Home  │  │ page-header (按 toolName)     │         │
│  Pop.  │  │  • search banner / sort tabs│         │
│  All   │  │  • sub banner / Joined      │         │
│        │  │  • user dropdown / nav...   │         │
│ Comm.  │  └─────────────────────────────┘         │
│  r/ML  │  ┌─────────────────────────────┐         │
│  r/LL  │  │ reddit-stage (现有模板内容)  │ ← 主区切卡 │
│  r/sg  │  │  • list / item / tree       │         │
│        │  │  • flash 仍命中卡内 anchor   │         │
└────────┴──┴─────────────────────────────┴─────────┘
```

### 三层都在动

- **topbar search input**：`reddit_search` 卡 active 时填 query；其他卡留空
  placeholder（`syncShellState` 自动同步）
- **leftnav**：固定 Feeds + 动态 Communities 区。`buildRedditShell({ communities })`
  在 translate 时扫一遍 timeline 收集本会话访问过的 sub（按首次出现顺序、去重，
  最多 12 条）；当前 active card 对应的 sub 自动加 `.active` class（橙色色条 + 圆图标变橙）
- **page-header**：每张卡专属。reddit_search → search banner + type/sort pills；
  reddit_subreddit_about → sub banner + meta-pill；reddit_list_subreddit →
  sub banner + Hot/New/Top/Rising tabs（payload.sort 高亮）；reddit_session_state →
  user dropdown 展开态

### 启用 / 关闭

- 默认启用：`session.meta.skillId` 包含 `reddit` 时 `<body data-shell="reddit">`，
  shell 自动出现
- 自动跳过：其他 skillId 走老路径（`<body data-shell="none">`），CSS 作用域
  `body[data-shell="reddit"]` 隔离，零回归
- 强制覆盖：传 `--skill <id>` 显式指定

### 老 session 兼容

v0.2.0 的 events.jsonl 不需要重录就能用 v0.3.0 重渲——shell / page-header 完全
是渲染层叠加，不改 events 结构、不改模板 ctx、不改 timeline track 字段。实测
sess-ai-self-evolution-final（v0.2.0 录的 14 步）用 v0.3.0 重渲：14 张卡各自
配 page-header，3 个 sub 全部出现在 leftnav，77 个 flash 全命中（tier=exact），
missingTemplates=[]。

## Fixtures

- [`__fixtures__/sess-reddit-list-html/`](__fixtures__/sess-reddit-list-html) — A 路线主链路 baseline（reddit list-subreddit，有 `payload`、无 `frames/`）。
- [`__fixtures__/sess-firefox-2.7.0/`](__fixtures__/sess-firefox-2.7.0) — **archived** PNG-mode baseline，仅供 dev/debug 路径回归 `captureFrame.js`。

## 模块映射

| 文件 | 作用 |
|---|---|
| `lib/translator.js` | 主入口，`translate(sessionDir, outDir, opts)` |
| `lib/timeline.js` | events.jsonl → `{hud, flash, relation, before, after}` |
| `lib/timelineScript.js` | 生成嵌入式 GSAP `<script>`（class-toggle 式 flash + v0.3.0 syncShellState） |
| `lib/styleEmbed.js` | reddit-style 卡片 + HUD + flash 动画 + v0.3.0 reddit shell CSS |
| `lib/shellLayout.js` | v0.3.0：`buildRedditShell({ communities })` 输出常驻 topbar + leftnav |
| `lib/hudClips.js` | HUD `<aside>` HTML 片段 |
| `templates/registry.js` | (skillId, kind) → renderer 映射 + 5 档查找链 + `findUnknownKinds` |
| `templates/reddit/*.js` | reddit 五种 kind 的 HTML 模板 |
| `templates/reddit/pageHeader.js` | v0.3.0：`renderPageHeader(ctx)` 按 toolName 分发渲不同 page header |
| `templates/_generic/*.js` | v0.2.0 终极兜底（`('*','*')`），未知 kind 智能渲 list/kv/raw |
| `cli/jse-replay.js` | CLI：translate + spawn hyperframes |
| `cli/jse-template-scaffold.js` | v0.2.0：从 session 反推未注册 (skillId, kind) → 生成模板骨架 |

## 许可

MIT
