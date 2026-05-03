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
register(skillId: string | '*', kind: 'list'|'item'|'tree'|'global'|'navigation'|'write',
         renderer: (ctx: TemplateContext) => string,
         opts?: { defaultClass?: string }): void;

type TemplateContext = {
  payload: object | null;
  anchorId: string;
  hint: { kind: string; label: string; target: string };
  label: string;
  target: string;
  tone: 'info' | 'success' | 'danger' | 'pending';
  eventIndex: number;
  sequence: { current: number; total: number };
};
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

## Fixtures

- [`__fixtures__/sess-reddit-list-html/`](__fixtures__/sess-reddit-list-html) — A 路线主链路 baseline（reddit list-subreddit，有 `payload`、无 `frames/`）。
- [`__fixtures__/sess-firefox-2.7.0/`](__fixtures__/sess-firefox-2.7.0) — **archived** PNG-mode baseline，仅供 dev/debug 路径回归 `captureFrame.js`。

## 模块映射

| 文件 | 作用 |
|---|---|
| `lib/translator.js` | 主入口，`translate(sessionDir, outDir, opts)` |
| `lib/timeline.js` | events.jsonl → `{hud, flash, relation, before, after}` |
| `lib/timelineScript.js` | 生成嵌入式 GSAP `<script>`（class-toggle 式 flash） |
| `lib/styleEmbed.js` | reddit-style 卡片 + HUD + flash 动画 CSS |
| `lib/hudClips.js` | HUD `<aside>` HTML 片段 |
| `templates/registry.js` | (skillId, kind) → renderer 映射 |
| `templates/reddit/*.js` | reddit 五种 kind 的 HTML 模板 |
| `cli/jse-replay.js` | CLI：translate + spawn hyperframes |

## 许可

MIT
