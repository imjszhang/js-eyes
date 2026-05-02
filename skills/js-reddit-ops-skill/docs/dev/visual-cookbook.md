# Visual Cookbook (reddit-ops)

如何为 reddit-ops 的工具加 / 改视觉反馈。本文配合 `@js-eyes/visual-bridge-kit` 一起读。

## 1. 现有反馈在哪里

```
CLI parseArgv (--visual*)
   │
   ▼
parseVisualFlags(opts)         packages/visual-bridge-kit/node/visualConfig.js
   │
   ▼
Session({ visualConfig })      skills/js-reddit-ops-skill/lib/session.js
   │  ensureBridge() 末尾
   ▼  callRaw('window.__jse_visual.config({...})')
[bridge IIFE]
   │  // @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js
   │  // @@include ./_visual-reddit.js
   ▼
window.__jse_visual = { ... }  ← 整个反馈层
```

调度链路两端：

```
runTool / runCallCommand / runNavigateCommand
   │
   ▼ wrapCallApi(session, hint, fn)
       ├── before:  __jse_visual.before(hint)        ← HUD pending + 锚点 flash
       ├── fn():    session.callApi(method, args)
       └── after:   __jse_visual.after(hint, summary) ← HUD success/danger + list/tree 演出

drainVisualEvents(session)  →  appendVisualTrace(tracePath)
```

## 2. 给一个新工具加 hint

`lib/visualHint.js` 的 `HINTS` 表是单一来源。每个工具一项：

```js
HINTS.reddit_my_new_tool = {
  kind: 'list',                    // global | item | list | tree | navigation | write
  label: ({ args }) => `r/${args.sub} 新功能 limit=${args.limit}`,
  anchor: ({ args }) => (args.sub ? { subreddit: args.sub } : null),
  target: ({ args }) => `r/${args.sub}`,
  detail: ({ args }) => '',
  tone: 'pending',                 // before 阶段的色调；after 由 summary.ok 决定
};
```

字段语义：

| 字段 | 必需 | 说明 |
|---|---|---|
| `kind` | ✓ | 决定 after 演出方式：`list` 给 items stagger flash；`tree` 画 relation 线；其它仅 HUD + 单点 flash |
| `label` | ✓ | HUD 第一行；可以是函数（接 `{ args, toolName }`）或常量 |
| `anchor` | – | before/after 主 flash 对象。任何 `_visual-reddit.js::resolveAnchor` 能识别的 spec：fullname、`{subreddit:'x'}`、`{user:'y'}`、URL、CSS selector |
| `target` | – | HUD 第二行（人读副标题） |
| `detail` | – | HUD 第三行 |
| `tone` | – | `pending` / `info` / `success` / `danger`，仅 before 阶段用 |

## 3. 让 list / tree 演出对

### list

只要 `summary.items` 是 fullname 数组，`__jse_visual.staggerFlashItems` 就会按 `--visual-list-stride`（默认 90ms）逐个 flash。

`buildSummary(resp, hint)` 已经做了"通用抽取"：从 `resp.data.items[]` 取前 8 个 `t3_*` / `t1_*` / `t2_*` / `t4_*` / `t5_*`。如果你的工具返回不一样的结构（比如包了一层 `groups[]`），override `buildSummary`：

```js
// 在 cli/index.js 的 wrapCallApi 调用处自定义 buildSummary
buildSummary: (r) => {
  if (!r || r.ok === false) return { ok: false, errorCode: r && r.error, items: [], relate: [] };
  const items = (r.data?.groups || []).flatMap((g) => g.items.map((it) => it.id));
  return { ok: true, items: items.slice(0, 8), relate: [] };
}
```

### tree

`relate: [{ from: 't3_p', to: 't1_c', label: '' }]`。`from`、`to` 都需要 reddit fullname；调度层会调 `resolveAnchor` 反查 DOM 后 `flashRelation` 画连线。

`buildSummary` 默认从 `items[].parent_id` 拼，对 `reddit_expand_more` 的输出已经够用。如果你做的是 `getPost`（嵌套 replies 树），把 nested 树 flatten 成 parent→child 数组再扔给 `relate`。

## 4. reddit fullname 锚点速查表

| 类型 | fullname | shreddit | old reddit |
|---|---|---|---|
| 帖子 | `t3_xxx` | `shreddit-post[id="t3_xxx"]` | `#thing_t3_xxx` |
| 评论 | `t1_xxx` | `shreddit-comment[thingid="t1_xxx"]` | `.comment[data-fullname="t1_xxx"]` / `#thing_t1_xxx` |
| 子版块 | `t5_xxx` / `r/<sub>` | `shreddit-subreddit-icon[name="<sub>"]` / `a[href^="/r/<sub>/"]` | `a[href^="/r/<sub>/"]` |
| 用户 | `t2_xxx` / `u/<user>` | `a[href^="/user/<user>/"]` | 同 |
| 私信/通知 | `t4_xxx` | `[data-fullname="t4_xxx"]` | 同 |

`bridges/_visual-reddit.js::resolveAnchor` 已实现以上全部分支，且在解析失败时返回 null（→ HUD-only 自动降级）。

## 5. 写操作的"乐观演示"接口（v0.2 预留）

reddit-ops 当前没有 vote / submit / comment（DESTRUCTIVE 红线），但 hint schema 已经预留：

```js
HINTS.reddit_vote = {
  kind: 'write',
  label: ({ args }) => `投票 ${args.id} ${args.dir > 0 ? '+1' : '-1'}`,
  anchor: ({ args }) => args.id,
  expectAnchor: ({ args }) => args.id,   // 写完后期望此元素出现 / 状态变化
  mutationObserver: true,                 // 由 v0.2 的 visual-bridge-kit 实现
};
```

未来加写操作时按这个 schema 即可，调度层会自动用 `MutationObserver` 等真实 DOM 出现，3s 超时降级 HUD"已提交，等待出现"。

## 6. trace jsonl 的字段

每次工具调用结束追加一行：

```json
{
  "ts": "2026-05-02T07:33:12.789Z",
  "runId": "...",
  "skillId": "js-reddit-ops-skill",
  "toolName": "reddit_list_subreddit",
  "args": { "sub": "AskReddit", "sort": "hot", "limit": 8 },
  "hint": { "kind": "list", "label": "...", "anchor": {"subreddit": "AskReddit"} },
  "ok": true,
  "durationMs": 1342,
  "events": [
    { "ts": 1746173592345, "type": "before", "kind": "list", "label": "...", "anchor": {...} },
    { "ts": 1746173592451, "type": "hud", "tone": "pending", "action": "..." },
    { "ts": 1746173593212, "type": "after", "kind": "list", "ok": true, "count": 8 },
    { "ts": 1746173593301, "type": "flash", "tone": "info", "label": "...", "anchor": "t3_aaa" }
  ]
}
```

回放：`require('@js-eyes/visual-bridge-kit').readVisualTrace('runs/visual-demo.jsonl')`。

## 7. 演示脚本

```bash
# 标准演示（4 步）
node scripts/_dev/visual-demo.js

# 不同 sub + 自定义查询
node scripts/_dev/visual-demo.js --sub science --query "fusion"

# 仅 HUD（不在 DOM 上画 box）
node scripts/_dev/visual-demo.js --visual-mode hud

# 落 jsonl
node scripts/_dev/visual-demo.js --visual-trace runs/visual-demo.jsonl
```

## 8. 关掉视觉

`--no-visual` 等价于 reddit-ops 3.4.x 的纯日志行为。`--visual-mode off` 同样关闭，但仍允许 `__jse_visual.config()` 接受运行期改回。

## 9. 与 newidea-cli-test 共享

newidea-cli-test 在另一仓库（不在 monorepo 内），后续可以把它的三份 visual 切换到 `@js-eyes/visual-bridge-kit/bridge/visual.common.js`。届时所有项目共享同一份"演出语言"。当前 reddit-ops 是首个接入，留下了完整接入路径供后续 9 个 ops skill 复制。
