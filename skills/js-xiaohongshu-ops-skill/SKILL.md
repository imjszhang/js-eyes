---
name: js-xiaohongshu-ops-skill
description: 小红书内容读取 skill，提供笔记详情、评论、搜索、用户主页等多 profile READ + 受控 INTERACTIVE 导航能力。
version: 3.0.0
metadata:
  openclaw:
    emoji: "\U0001F338"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      bins:
        - node
---

# js-xiaohongshu-ops-skill

面向小红书内容读取的 skill。v2.1 起按 [skills/js-x-ops-skill](../js-x-ops-skill) 的 PAGE_PROFILES + Bridges + Session 架构重构，支持笔记 / 搜索 / 用户 / 首页四个 profile，并按 v2.1 → v3.x 阶段渐进交付：

- v2.1（当前）：架构铺底，落 `note-bridge` 与 `xhs_get_note` / `xhs_get_note_comments` / `xhs_session_state` 三个 READ 工具。
- v2.2：搜索域（`search-bridge` + `xhs_search_notes` + 4 个 INTERACTIVE 导航工具）。
- v2.3：用户域（`user-bridge` + `xhs_get_user` / `xhs_get_user_notes`）。
- v3.0：监控子系统（accounts + searches 两类 target）。
- v3.x：限流 / 反爬 / visual-bridge-kit / cookie sanitize 治理。

## 安全分级

- **READ**：`xhs_get_note`、`xhs_get_note_comments`、`xhs_session_state`（v2.1）。
- **INTERACTIVE**：`xhs_navigate_*`（v2.2 起）。仅 `location.assign`，不模拟点击、不改 DOM。
- **DESTRUCTIVE**：**永不引入**。本 skill 不提供发笔记 / 评论 / 点赞 / 收藏 / 关注。

## READ 调度（readMode）

`xhs_get_note` 默认 `readMode='auto'`，**与 X 取反**：

- `auto`：DOM 优先 → API 兜底（小红书 DOM 覆盖更广，feed JSON 不稳定）。
- `dom`：仅 DOM 抽取。
- `api`：仅 API（笔记详情 stub，主用于评论/调试）。

`xhs_get_note_comments` 默认 `readMode='api'`（基于 edith `/api/sns/web/v2/comment/page`，分页稳定）。

## 提供的 AI 工具（v3.0）

| 工具 | 类型 | 说明 |
|------|------|------|
| `xhs_get_note` | READ | 笔记详情 + 可选评论 |
| `xhs_get_note_comments` | READ | 评论分页（API 主路径） |
| `xhs_session_state` | READ | 登录态读取（cookie a1/web_session + DOM 昵称） |
| `xhs_search_notes` | READ | 搜索（频道 / 筛选 / 联想 / 相关搜索 / 滚动） |
| `xhs_get_user` | READ | 用户主页资料（昵称、签名、关注/粉丝/获赞） |
| `xhs_get_user_notes` | READ | 用户笔记列表（滚动分页） |
| `xhs_navigate_*` | INTERACTIVE | navigate-note / search / user / home（仅 location.assign） |
| `xhs_monitor_list_targets` | READ | 列出 monitor accounts + searches + channels |
| `xhs_monitor_get_status` | READ | daemon pid + 各 target lastCheck/notesCount |
| `xhs_monitor_add_target` | READ | 增加一个 user/search target（仅写 config，不发通知） |
| `xhs_monitor_remove_target` | READ | 删除一个 user/search target |
| `xhs_monitor_test_target` | READ | 单 target dry run（不写 state、不发通知） |

> **monitor 红线**：`monitor init` / `monitor check` / `monitor daemon` / `monitor stop` 会触发 webhook，**仅 CLI 暴露**，不进 AI 工具列表。

## Monitor 子系统

```bash
# 初始化默认 config
node skills/js-xiaohongshu-ops-skill/index.js monitor init

# 添加用户监控 / 关键词监控
node skills/js-xiaohongshu-ops-skill/index.js monitor add user <userId>
node skills/js-xiaohongshu-ops-skill/index.js monitor add search "穿搭" --channel-type 图文

# 同步跑一次完整 check（会发 webhook）
node skills/js-xiaohongshu-ops-skill/index.js monitor check --pretty

# 启动循环 daemon
node skills/js-xiaohongshu-ops-skill/index.js monitor daemon --interval 1800
node skills/js-xiaohongshu-ops-skill/index.js monitor stop

# 状态
node skills/js-xiaohongshu-ops-skill/index.js monitor status --pretty
```

支持 `feishu` / `discord` / `generic_webhook` / `console` 4 种通知渠道，schema 在 `~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor/config.json`，可由 `JS_XHS_MONITOR_HOME` 覆盖。
| `xhs_navigate_note` | INTERACTIVE | 仅 location.assign 导航到笔记详情 |
| `xhs_navigate_search` | INTERACTIVE | 仅 location.assign 导航到搜索页 |
| `xhs_navigate_user` | INTERACTIVE | 仅 location.assign 导航到用户主页 |
| `xhs_navigate_home` | INTERACTIVE | 仅 location.assign 导航到探索流首页 |

## CLI

```bash
# 笔记详情（含评论）
node skills/js-xiaohongshu-ops-skill/index.js note "https://www.xiaohongshu.com/explore/xxxx" --with-comments --max-comment-pages 2 --pretty

# 评论分页
node skills/js-xiaohongshu-ops-skill/index.js comments "https://www.xiaohongshu.com/explore/xxxx" --max-comment-pages 5 --pretty

# 登录态
node skills/js-xiaohongshu-ops-skill/index.js session-state --pretty

# Doctor（4 profile 一站诊断）
node skills/js-xiaohongshu-ops-skill/index.js doctor --pretty

# 老路径 fallback（关闭 bridge）
JS_XHS_DISABLE_BRIDGE=1 node skills/js-xiaohongshu-ops-skill/index.js note "https://www.xiaohongshu.com/explore/xxxx"
```

## 评论与登录态（v3.1）

小红书评论 API（`/api/sns/web/v2/comment/page` 等）必须有登录态，否则会回 `code:300011 "Account abnormal"`。skill 在两处做了门控：

1. **入口预检**：`runTool` 在调用 `xhs_get_note_comments` 或 `args.withComments===true` 时，会先调一次 `sessionState`，若 `cookieFlags.hasWebSession === false` 则直接短路返回 `error: 'login_required'` + `loginUrl: 'https://www.xiaohongshu.com/login'`，避免无谓打扰风控。
2. **bridge 内层兜底**：`api_getComments` 自身也会再校验一次，返回 `login_required` 与 `loginUrl`，便于 AI/上游识别。

CLI 提供 `xhs login` 引导子命令（仅 CLI，不暴露给 AI）：

```bash
# 引导登录：打开登录页 + 轮询 web_session cookie 出现（默认最多 5 分钟）
node skills/js-xiaohongshu-ops-skill/index.js login --pretty
node skills/js-xiaohongshu-ops-skill/index.js login --timeout-ms 600000 --pretty
```

成功后输出 `{ ok:true, cookieFlags:{ hasWebSession:true, ... }, elapsedMs }`，超时则 `{ ok:false, error:'login_timeout' }`。

## 如何查看抓到的数据（v3.1）

每次 READ 工具跑完会把 history 行 append 到 `~/.js-eyes/skill-data/<skillId>/history/<YYYY-MM>.jsonl`，cache 与 debug bundle 同目录其它子目录。`runReadTool` 会在 stderr 输出一行提示（除非加了 `--quiet`）：

```
[xhs] records: /Users/x/.js-eyes/skill-data/.../history/2026-05.jsonl (notes=20)
```

result 顶层 `run.paths.{historyFile,historyDir,cacheDir,debugDir}` 也包含完整路径，便于上游脚本/AI 直接定位。

CLI 提供 `xhs records` 子命令快速查看最近的 records：

```bash
node skills/js-xiaohongshu-ops-skill/index.js records --last 5 --pretty
node skills/js-xiaohongshu-ops-skill/index.js records --tool xhs_get_note --last 10 --pretty
```

输出每条包含：`run_id / tool / timestamp / status / duration_ms / cache_hit / input(摘要) / error / debugBundlePath`。

## runToolAudit 字段（v2.1）

每次 READ 工具返回顶层包含：

- `triedMethods` – 尝试过的 bridge 方法序列（如 `['dom_getNote','api_getNote']`）。
- `usedMethod` – 最终用了哪个 bridge 方法。
- `readMode` – `'dom'` / `'api'`。
- `requestedReadMode` – 调用方传入的 `readMode`（`'auto'` / `'dom'` / `'api'`）。
- `fallback` – 是否触发跨档位回退。
- `antiCrawlState` – `{ paused, pauseUntil, consecutiveRiskHits }`，由 bridge 共享。

## Visual（v3.1，硬依赖）

完整接入 `@js-eyes/visual-bridge-kit`（与 `@skills/js-x-ops-skill` 等价）：bridge 内核装 `window.__jse_visual`，runTool 用 `wrapCallApi + drainVisualEvents`，工具粒度 hint 由 [lib/visualHint.js](lib/visualHint.js) 提供，可选写 trace JSONL + JPEG 帧序列 + visual session bundle 给 hyperframes 等下游消费。

### CLI 旋钮

- `--visual` / `--no-visual`：总开关。
- `--visual-hud` / `--no-visual-hud`：右上角 HUD 卡片。
- `--visual-flash` / `--no-visual-flash`：元素 flash overlay。
- `--visual-trace [path]`：单文件 JSONL trace；不传 path 时落到默认 visualDir。
- `--visual-record [dir]`：完整 session bundle（events.jsonl + meta.json + JPEG 帧序列）。
- 高级：`--visual-flash-ms / --visual-linger-ms / --visual-pinned-hold / --visual-error-pin / --visual-list-stride / --visual-prefix`，详见 `@js-eyes/visual-bridge-kit/node/visualConfig.js::DEFAULTS`。
- deprecated：`--visual-mode`（v0.6 拆成 hud/flash）、`--visual-ms`（v0.7 改名 `--visual-flash-ms`）。被 `parseVisualFlags` 检出后 stderr 一次性告警。

### 输出位置

- 默认 visualDir：`~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/visual/<runId>/`（与 history/cache/debug 同级）。
- `<visualDir>/trace.jsonl`：所有 drain 出的 events 一行一条 JSON（type/ts/anchor/payload …）。
- `<visualDir>/events.jsonl` + `<visualDir>/meta.json`：visual session bundle。
- `<visualDir>/frame-*.jpg`：开 `--visual-record` 后才生成（与 events.jsonl/meta.json 同目录），每次 callApi 边界一帧（默认上限 60 帧、quality 82，hyperframes 默认在同目录找帧）。

跑完后 stderr 输出一行 `[xhs] visual: <path> (events=N)`，与 records 路径并列。

### 顶层结果字段

```jsonc
{
  "visual": {
    "enabled": true,
    "hint": { "kind": "item", "toolName": "xhs_get_note", "label": "笔记 · ...", "anchor": { "noteId": "..." } },
    "events": [/* drain 出的 emit 事件 */],
    "eventsCount": 12,
    "traceFile": ".../visual/<runId>/trace.jsonl",
    "recordDir": ".../visual/<runId>",
    "framesEnabled": true
  }
}
```

### 验收链路

```bash
# 1) HUD + flash 高亮
node skills/js-xiaohongshu-ops-skill/index.js note "https://www.xiaohongshu.com/explore/<id>?xsec_token=..." \
  --visual --visual-hud --visual-flash --pretty

# 2) trace JSONL（默认目录）
node skills/js-xiaohongshu-ops-skill/index.js note "<url>" --visual --visual-trace --pretty
#  → tail -1 ~/.js-eyes/skill-data/.../visual/<runId>/trace.jsonl

# 3) 完整录制（含 JPEG 帧序列）
node skills/js-xiaohongshu-ops-skill/index.js note "<url>" --visual --visual-record --pretty
#  → ls ~/.js-eyes/skill-data/.../visual/<runId>/frames/

# 4) doctor 看 4 profile bridge 都注入了 __jse_visual
node skills/js-xiaohongshu-ops-skill/index.js doctor --pretty

# 5) 顶层结果字段
node skills/js-xiaohongshu-ops-skill/index.js note "<url>" --visual --json | python -c "import json,sys; r=json.load(sys.stdin); print('visual.events=', len(r['visual']['events']))"
```

### 站点 anchor resolver（v3.1.1）

[bridges/_visual-xhs.js](bridges/_visual-xhs.js) 通过 `window.__jse_visual.setSiteAnchorResolver(fn)` 把 hint.anchor 映射到具体 DOM：

| anchor | 当前页 | 优先 selector | fallback |
|---|---|---|---|
| `{ noteId }` | 笔记详情页（URL 含同名 noteId） | `#noteContainer` / `.note-container` | `.feeds-page` |
| `{ noteId }` | 搜索 / explore 列表 | `a[href*='/explore/<noteId>'].closest('section.note-item')` | 直接 `<a>` |
| `{ userId }` | 用户主页（URL 含 `/user/profile/<userId>`） | `.user-info-card` / `.user-info-wrapper` / `.user-page` | — |
| `{ userId }` | 列表页 | `a[href*='/user/profile/<userId>'].closest('.author-wrapper')` | 直接 `<a>` |
| `{ commentId }` | 笔记详情页 | `.comments-container` / `.comments-el`（整片，commentId 不暴露在 DOM） | — |

resolver 命中时会多 emit 2 条 `flash(pending)` / `flash(success)` 事件（默认 hud-only 时只有 hud + before/after，共 4 条；resolver 命中后 6 条 + frame=7）。

### 与 hyperframes 联动

`<visualDir>` 即 `@js-eyes/visual-replay-hyperframes` 的 `jse-replay` 输入；anchorId 命名空间统一为 `note:<noteId>` / `user:<userId>` / `comment:<commentId>`，与 [lib/visualHint.js](lib/visualHint.js) 的 `extractPayload` 卡片字段对齐，离线 composition 时 `.flash-active` 能正确附到节点。

## Recording

接入统一 skill recording 底座（`@js-eyes/skill-recording`）：

- 跟随 `js-eyes` 全局配置中的 `recording.mode`。
- CLI 可覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

> v3.x：`a1` / `web_session` / `webId` 等敏感 cookie 在写入 history / debug 落盘前**强制 mask**（`lib/xhsUtils.js::sanitizeForRecording`）。

## 架构

```
skills/js-xiaohongshu-ops-skill/
  SKILL.md
  package.json
  index.js                     委托 cli/index.js
  skill.contract.js            工厂化 + AI 工具表
  cli/index.js                 dispatcher（读 lib/commands.js）
  lib/
    api.js                     编程 API（默认 useBridge）
    session.js                 主调度器（PAGE_PROFILES + bridge 注入）
    runTool.js                 READ 主管道（readMode + audit + history）
    config.js                  PAGE_PROFILES（note/search/user/home）
    commands.js                CLI 声明式映射
    toolTargets.js             工具参数 → URL
    runtimeConfig.js           server/recording 配置
    bridgeAdapter.js           noteViaBridge / commentsViaBridge / 等
    js-eyes-client.js          BrowserAutomation
    xhsUtils.js                URL 规整 / 字段标准化 / sanitize
  bridges/
    common.js                  fetchXhsApi + parseNoteMeta + DOM helpers + detectAntiCrawl
    note-bridge.js             VERSION='0.1.0' getNote/getComments + 五件套
  scripts/
    xhs-note.js                fallback（JS_XHS_DISABLE_BRIDGE=1 时使用）
  tests/                       node --test
```

## 与 X / Reddit 主线的差异

- **readMode 默认**：xhs `auto = DOM 优先`；X `auto = GraphQL 优先`。
- **DESTRUCTIVE**：xhs **永不引入**；X 在 v3.1 拆 compose-bridge。
- **反爬**：xhs 有 og:xhs:note_* 三件齐全判定 + 连续 3 次 risk hit 暂停 5 分钟；X 仅 429 暂停。
- **监控对象**（v3.0+）：xhs 同时支持「用户」与「关键词搜索」两类 target；X 只有 account。
