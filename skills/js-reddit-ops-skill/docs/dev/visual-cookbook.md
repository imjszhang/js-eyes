# Visual Cookbook (reddit-ops, post-2.7.0 architecture pivot)

如何为 reddit-ops 工具加 / 改"视觉反馈 + 视频回放"。本文配合两个上游包一起读：

- [`@js-eyes/visual-bridge-kit`](../../../../packages/visual-bridge-kit/README.md) — bridge 注入、CLI flag、`extractPayload` 钩子
- [`@js-eyes/visual-replay-hyperframes`](../../../../packages/visual-replay-hyperframes/README.md) — HTML 模板、composition.html、jse-replay CLI

> **架构前提**（post-2.7.0 pivot）：浏览器内 in-page HUD/flash 仍在工具运行时显示（给操作者实时反馈），但**离线视频不再依赖截图**。视频内容由每次工具调用抽出来的 `payload`（业务字段）+ HTML 模板渲染而成，视口任意尺寸下卡片自适应、flash 跟随 0 错位。

## 1. 数据流速览

```
CLI parseArgv (--visual / --visual-record)
   │
   ▼
parseVisualFlags(opts)                   packages/visual-bridge-kit/node/visualConfig.js
   │   deprecatedFlags 检测  ─► warnDeprecatedFlagsOnce (一次性 stderr 告警)
   ▼
Session({ visualConfig })                skills/js-reddit-ops-skill/lib/session.js
   │  ensureBridge() 末尾
   ▼  callRaw('window.__jse_visual.config({...})')
[bridge IIFE]
   │  // @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js
   │  // @@include ./_visual-reddit.js
   ▼
window.__jse_visual = { ... }            ← in-page HUD / flash（运行时反馈）
```

调度链路（runTool / runCallCommand / runNavigateCommand）：

```
wrapCallApi(session, hint, fn, hooks)
   ├── before:  __jse_visual.before(hint)
   │              └─ in-page flash 锚点 + HUD pending（不再带 anchor.rect 进 emit）
   ├── fn():    session.callApi(method, args)
   ├── hooks.buildSummary(resp, hint, err)        ← items / relate / errorCode
   ├── hooks.extractPayload(resp, hint, err) ★    ← 业务字段 → summary.payload
   └── after:   __jse_visual.after(hint, summary)
                 └─ summary.payload 透传到 emit('after', { kind, payload, ... })

drainVisualEvents(session) → events: [..., { type:'after', kind, payload }]
appendVisualSession(recordDir, entry, { skillId, skillVersion })
   └─ events.jsonl + meta.json（payloadSchemaVersion: 1）
```

后续：`jse-replay <recordDir>` → 模板 → `composition.html` → `npx hyperframes render` → mp4。

## 2. 给一个新工具加 hint + extractor

### 2.1 hint（in-page 反馈层）

`lib/visualHint.js` 的 `HINTS` 表：

```js
HINTS.reddit_my_new_tool = {
  kind: 'list',                    // global | item | list | tree | navigation | write
  label: ({ args }) => `r/${args.sub} 新功能 limit=${args.limit}`,
  anchor: ({ args }) => (args.sub ? { subreddit: args.sub } : null),
  target: ({ args }) => `r/${args.sub}`,
  detail: ({ args }) => '',
  tone: 'pending',
};
```

| 字段 | 说明 |
|---|---|
| `kind` | 决定 in-page after 演出（`list` stagger flash items；`tree` 画 relation 线）+ 离线模板路由 |
| `label` | HUD 第一行 |
| `anchor` | in-page flash 主对象，且作为 events 里的 `anchor.spec` 落盘（HTML 模板用它绑 `data-anchor-id`） |
| `target` | HUD 第二行 |
| `tone` | before 阶段色调 |

### 2.2 extractPayload（HTML 模板的"输入"）

`lib/visualHint.js` 已经按 `hint.kind` 提供了通用 `extractPayload`。如果新工具响应是非常规 shape，自定义：

```js
// 在 cli/index.js 的 wrapCallApi 调用处覆盖：
extractPayload: (resp, hint, err) => {
  if (err) return { error: { message: err.message } };
  if (!resp || resp.ok === false) return null;
  // 你的工具返回了 { groups: [{ items: [...] }] }
  const flat = (resp.data?.groups || []).flatMap(g => g.items);
  return {
    items: flat.slice(0, 8).map(it => ({
      id: it.id, title: it.title, author: it.author, score: it.score,
      num_comments: it.num_comments, contentPreview: it.body?.slice(0, 200),
    })),
    totalCount: flat.length,
    sub: hint.target,
  };
}
```

payload shape 由 `hint.kind` 决定（参照[包级 README 的 payload schema 表](../../../../packages/visual-bridge-kit/README.md#eventsjsonl-payload-schema-post-270)）：

| `hint.kind` | payload shape |
|---|---|
| `list` | `{ items: [{id,title,author,subreddit,score,num_comments,...}], totalCount, sub, sort }` |
| `item` | 单条 item 字段（id/title/author/score/...）；或 `{ summary, fields:[{k,v}] }` 兜底 |
| `tree` | `{ items: [...], relations: [{from,to,depth?}] }` |
| `global` | `{ summary, fields: [{k,v}] }` |
| `navigation` | `{ from, to, hint:'page_will_reload', label }` |

## 3. reddit fullname 锚点速查表（in-page flash）

| 类型 | fullname | shreddit | old reddit |
|---|---|---|---|
| 帖子 | `t3_xxx` | `shreddit-post[id="t3_xxx"]` | `#thing_t3_xxx` |
| 评论 | `t1_xxx` | `shreddit-comment[thingid="t1_xxx"]` | `.comment[data-fullname="t1_xxx"]` |
| 子版块 | `t5_xxx` / `r/<sub>` | `shreddit-subreddit-icon[name="<sub>"]` | `a[href^="/r/<sub>/"]` |
| 用户 | `t2_xxx` / `u/<user>` | `a[href^="/user/<user>/"]` | 同 |
| 私信 | `t4_xxx` | `[data-fullname="t4_xxx"]` | 同 |

`bridges/_visual-reddit.js::resolveAnchor` 已实现以上分支。失败时返回 null（→ in-page HUD-only 自动降级），但 events 仍带 `anchor.spec`，离线模板仍能给对应 HTML 卡片绑 `data-anchor-id`。

## 4. 离线视频生成（HTML 模板路线）

### 4.1 录会话

```bash
# 推荐：会话包目录形态（包含 meta.json + events.jsonl）
node skills/js-reddit-ops-skill/cli/index.js list-subreddit MachineLearning \
  --visual --visual-record runs/pivot-list --limit 8

# 验证：events.jsonl 应含 payload，无 frameRef/anchor.rect/viewport
node -e "
const lines = require('fs').readFileSync('runs/pivot-list/events.jsonl','utf8').trim().split('\n');
for (const l of lines) {
  const e = JSON.parse(l);
  console.log(e.toolName, 'events=' + e.events.length, 'after.payload=', JSON.stringify(e.events.find(x=>x.type==='after')?.payload || null).slice(0, 80));
}
"
```

### 4.2 转译 + 预览

```bash
# 仅生成 composition/index.html
node packages/visual-replay-hyperframes/cli/jse-replay.js runs/pivot-list --no-render --keep-composition

# lint（应该 0 errors）
npx hyperframes lint runs/pivot-list/composition/

# 浏览器预览
npx hyperframes preview runs/pivot-list/composition/

# 渲染 mp4
node packages/visual-replay-hyperframes/cli/jse-replay.js runs/pivot-list --out demo.mp4
```

### 4.3 期待的视频内容

- **list-subreddit**：右上角 HUD 显示工具名 + r/MachineLearning + 计数；舞台中央纵向排列 8 张 reddit-style post 卡片；flash 时刻每张卡片 outline 高亮（不会跑出卡片范围）
- **search**：同上但 sub 标 `r/MachineLearning`、卡片来自搜索结果
- **expand-more**：评论树，按 depth 缩进，flash 落到对应 `t1_xxx` 节点
- **navigate-***：from→to URL 过场卡

任意视口尺寸缩放 → 卡片自适应 → flash 跟随 → 0 错位。

## 5. CLI flag 速查

仍生效：

```
--visual / --no-visual                  开关 in-page 视觉
--visual-detail compact|staged          演出强度
--visual-ms <n>                         flash 持续 ms
--visual-hud / --no-visual-hud          右上角 HUD 卡片（默认开；v0.6.0 取代 --visual-mode hud/dom）
--visual-flash / --no-visual-flash      元素 flash overlay/relation（默认开）
--visual-trace <file>                   单文件 jsonl trace
--visual-record [<dir>]                 会话包目录（A 路线主链路）
--visual-list-stride <ms>               in-page 列表呼吸感
--visual-prefix <p>                     in-page DOM id 前缀
```

post-2.7.0 已弃用（仍接受不报错，但不下发，CLI 启动时 stderr 一次性告警）：

```
--redact-rect / --redact-selector / --redact-config <path>
--visual-record-frames / --visual-frames-throttle <n>
```

## 6. 写操作的"乐观演示"接口（v0.2 预留 / 未实装）

reddit-ops 当前不做 vote / submit / comment（DESTRUCTIVE 红线）。hint schema 仍预留 `kind: 'write'`，离线模板首版按 `global` 兜底渲 key/value 卡。未来接写操作时增强 `extractPayload`：

```js
HINTS.reddit_vote = {
  kind: 'write',
  label: ({ args }) => `投票 ${args.id} ${args.dir > 0 ? '+1' : '-1'}`,
  anchor: ({ args }) => args.id,
};

// extractPayload 抽 { id, before:{score}, after:{score, dir}, ok }
```

## 7. trace / 会话包字段

`runs/<record-dir>/meta.json`：

```json
{
  "sessionId": "sess-...",
  "kitVersion": "0.4.0",
  "skillId": "js-reddit-ops-skill",
  "skillVersion": "3.6.0",
  "payloadSchemaVersion": 1,
  "toolNames": ["reddit_list_subreddit", "reddit_search"],
  "eventCount": 24,
  "startedAt": "2026-...",
  "updatedAt": "2026-..."
}
```

`runs/<record-dir>/events.jsonl`（每行一个工具调用）：

```jsonc
{
  "ts": "2026-...",
  "runId": "...",
  "skillId": "js-reddit-ops-skill",
  "toolName": "reddit_list_subreddit",
  "args": { "sub": "MachineLearning", "sort": "hot", "limit": 8 },
  "hint": { "kind": "list", "label": "抓 r/MachineLearning hot 8", "anchor": {"subreddit": "MachineLearning"} },
  "ok": true,
  "durationMs": 3098,
  "events": [
    { "ts": ..., "type": "before", "kind": "list", "label": "...", "anchor": {"subreddit": "MachineLearning"} },
    { "ts": ..., "type": "flash",  "tone": "pending", "label": "...", "anchor": {"subreddit": "MachineLearning"} },
    { "ts": ..., "type": "hud",    "tone": "pending", "action": "...", "target": "r/MachineLearning" },
    { "ts": ..., "type": "after",  "kind": "list", "ok": true, "count": 8,
      "payload": {
        "items": [{"id":"t3_xxx","title":"...","author":"...","score":1234,"num_comments":56,"subreddit":"MachineLearning","contentPreview":"..."}],
        "totalCount": 8, "sub": "MachineLearning", "sort": "hot"
      }
    }
  ]
}
```

注意：相比 2.7.0，events 不再有 `viewport` / `anchor.rect` / `frameRef` 字段，entry 不再有顶层 `frames` 数组。

## 8. dev / debug：仍想要 PNG 截图

A 路线不需要截图。但如果需要回归 dev fixture 或自行实验"HTML + PNG 缩略"混合方案：

```js
const { wrapCallApi } = require('@js-eyes/visual-bridge-kit');
const { makeFrameWriter } = require('@js-eyes/visual-bridge-kit/dev'); // ← 子路径
const { extractPayload } = require('./visualHint');

const writer = makeFrameWriter({ recordDir, getTabId, captureScreenshot });
await wrapCallApi(session, hint, fn, {
  buildSummary,
  extractPayload,
  captureFrame: writer, // dev only：fire-and-forget
});
```

PNG 仍写到 `<recordDir>/frames/`，但 `jse-replay` 不会读它。

## 9. 演示脚本（如有）

```bash
# 标准演示（4 步）
node scripts/_dev/visual-demo.js
# 录到目录
node scripts/_dev/visual-demo.js --visual-record runs/dev-visual
# 仅 HUD
node scripts/_dev/visual-demo.js --no-visual-flash
```

## 10. 复用到其它 ops skill

要把这套搬到 `js-x-ops-skill` / `js-zhihu-ops-skill`：

1. **运行时反馈**：`bridges/_visual-<site>.js` 实现 `resolveAnchor`（参考 `bridges/_visual-reddit.js`）
2. **业务数据**：`lib/visualHint.js` 加 HINTS + 实现按 kind 的 `extractPayload`
3. **HTML 模板**：在 `packages/visual-replay-hyperframes/templates/<site>/index.js` 注册自定义模板（也可直接复用 reddit 通用模板，仅写一个 stage 容器即可）
4. **CLI 接 wrapCallApi**：`hooks: { buildSummary, extractPayload }`

第 3 步是新增工作量。第 1、2、4 步直接复刻 reddit-ops 即可。
