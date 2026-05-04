---
name: js-reddit-ops-skill
description: Reddit 内容只读 + 浏览器导航 skill：帖子详情 / subreddit 列表 / 搜索 / 用户主页 / 收件箱 / 主 feed，DOM/API 双模式（auto 默认 DOM 优先 fallback API），浏览器侧仅 location.assign 改 URL。
version: 3.8.0
metadata:
  openclaw:
    emoji: "\U0001F4F0"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      skills:
        - js-eyes
      bins:
        - node
    platforms:
      - reddit.com
---

# js-reddit-ops-skill

面向 reddit.com 的**只读 + 仅改自身浏览器 URL**的 skill。从 v3.0 起切到 `PAGE_PROFILES + Bridges + Session` 架构，参考 [`js-wechat-mp-ops-skill`](../js-wechat-mp-ops-skill/SKILL.md) 的设计取舍：

- **数据获取**：READ 数据优先走 reddit 公开 JSON 端点（`*.json` / `oauth.reddit.com`），与浏览器同源、复用 cookie；DOM 解析（`lib/redditUtils.js`）保留为兜底
- **双前端兼容**：bridge 内 `detectFrontend()` 区分 shreddit（新版）/ old.reddit（旧版）；JSON 主路径与前端无关
- **安全分级**：只做 READ + INTERACTIVE 两档，**永不**做 DESTRUCTIVE（不投票 / 不评论 / 不发帖 / 不订阅 / 不发私信 / 不举报）

## 依赖与前置

- **JS Eyes Server**：已启动（`js-eyes server start`）
- **浏览器扩展**：已安装并连上 server
- **登录态（可选）**：浏览器里已经人工登录 reddit.com（本 skill 不做任何登录自动化）；未登录可调 READ 公开内容；登录后可调 inbox / 个人 saved/upvoted 等 tab
- **任意 reddit.com tab 即可**：READ 工具默认 `navigateOnReuse=false / reuseAnyRedditTab=true`，bridge 在任意 reddit.com tab 里 fetch 同源 JSON 端点；用户当前 tab 不会被切走
- **双侧 `allowRawEval`**：bridge 首次注入会走一次 `bot.executeScript(rawSource)`；之后每次工具调用只执行 `window.__jse_reddit_*__.<method>()`
  - 宿主：`~/.js-eyes/config/config.json` 里 `security.allowRawEval: true`
  - 扩展：js-eyes 扩展 popup 里 `Allow Raw Eval` 打开
  - 少一侧会返回 `RAW_EVAL_DISABLED`

## 安全红线（READ / INTERACTIVE / DESTRUCTIVE）

本 skill 的所有工具都会被归入以下三档之一。审计界线按「是否改 reddit 业务数据」而非「是否触网」来划：

### READ（默认档）

纯读，不改任何 DOM、不改 URL、不触发任何业务写操作。

- 走 `fetchRedditJson(path, params)` 重放 reddit 公开 JSON 端点（GET，复用浏览器同源 cookie）
- DOM 路径仅作为 bridge 失败时的兜底，由 `lib/redditUtils.js` cheerio 解析提供
- 工具：`reddit_get_post` / `reddit_session_state` / `reddit_list_subreddit` / `reddit_subreddit_about` / `reddit_search` / `reddit_user_profile` / `reddit_inbox_list` / `reddit_my_feed` / `reddit_expand_more`

### INTERACTIVE（v3.2+）

**只改浏览器自己的 URL**，不改 reddit 侧任何业务数据。实现硬约束：

- 仅 `location.assign(newUrl)`，**禁止模拟点击任何 DOM CTA**
- bridge 端 `navigateLocation()` 拒绝跨域 URL（必须是 `*.reddit.com`）
- 调用返回 `{from, to, hint}`，CLI 端 `awaitBridgeAfterNav` 重注 bridge + state 自校验
- `skill.contract.js` 里带 `interactive: true` / `destructive: false`
- 工具：`reddit_navigate_post` / `reddit_navigate_subreddit` / `reddit_navigate_search` / `reddit_navigate_user` / `reddit_navigate_inbox` / `reddit_navigate_home`

### DESTRUCTIVE（永不做）

任何改 reddit 业务数据 / 触发账户变更的操作，从 v3.0 起一直不会做：

- 不投票 / 不评论 / 不发帖 / 不编辑 / 不删除
- 不 save / unsave / hide / report
- 不 follow / unfollow / subscribe / unsubscribe / block
- 不发送 / 删除 / 标记已读私信
- 不实现登录自动化 / 不注入 cookie / 不伪造 modhash / bearer token

如果未来真的要做，将在 `skill.contract.js` 里把该工具标记 `destructive: true`，并要求调用方显式 `--confirm` 走 Safe Default Mode consent 流程。

## 提供的 AI 工具

| 档位 | 工具 | 页面 | 说明 |
|---|---|---|---|
| READ | `reddit_get_post` | `/r/<sub>/comments/<id>/` | 帖子详情：标题 / 正文 / 作者 / 评分 / 图片 / 评论树（`depth` / `limit` / `sort` 可控） |
| READ | `reddit_session_state` | 任意 reddit tab | 登录态：`/api/v1/me.json` 优先 + DOM 兜底，回 `{loggedIn, name, totalKarma, modhash}` |
| READ | `reddit_list_subreddit` | `/r/<sub>` | 列出 subreddit 内帖子；`sort=hot/new/top/rising/controversial`，`t=hour/day/...`，分页 `limit/after` |
| READ | `reddit_subreddit_about` | `/r/<sub>/about` | subreddit 元信息：订阅数 / 描述 / NSFW / 创建时间 / 头像 |
| READ | `reddit_search` | `/search` 或 `/r/<sub>/search` | 搜索：`type=link/sr/user`，`sub` 限定，分页 `limit/after` |
| READ | `reddit_user_profile` | `/user/<name>/<tab>` | 用户主页：`tab ∈ overview/submitted/comments/saved/upvoted/downvoted/gilded/hidden`（后五个需登录且仅自己可见） |
| READ | `reddit_inbox_list` | `/message/<box>` | 收件箱：`box ∈ inbox/unread/messages/mentions/sent/moderator`（必须已登录） |
| READ | `reddit_my_feed` | `/`、`/r/popular`、`/r/all` | 主 feed：`feed=home/popular/all`，`sort=best/hot/new/top/rising` |
| READ | `reddit_expand_more` | `/api/morechildren` | 把 `reddit_get_post` 评论树里 `_kind:'more'` 节点的 `_children` 展开成扁平 `items[]` + `byParent` 索引；`limitChildren` 默认 200 / 最大 500 |
| INTERACTIVE | `reddit_navigate_post` | `/r/<sub>/comments/<id>/` | 仅 `location.assign` 跳到帖子页 |
| INTERACTIVE | `reddit_navigate_subreddit` | `/r/<sub>/<sort>/` | 仅 `location.assign` 切 subreddit + sort |
| INTERACTIVE | `reddit_navigate_search` | `/search` 或 `/r/<sub>/search` | 仅 `location.assign` 设搜索 q / sort / t / type / restrict_sr |
| INTERACTIVE | `reddit_navigate_user` | `/user/<name>/<tab>` | 仅 `location.assign` 切用户和 tab |
| INTERACTIVE | `reddit_navigate_inbox` | `/message/<box>` | 仅 `location.assign` 切 inbox box |
| INTERACTIVE | `reddit_navigate_home` | `/`、`/r/popular`、`/r/all` | 仅 `location.assign` 切主 feed + sort |

全部工具都是 `optional: true`（按需加载），入参详见 `skill.contract.js::TOOL_DEFINITIONS`。

### 内部踩点 CLI（不进 `skill.contract.js`，仅供本仓库开发者排查）

下面两条只在 CLI 暴露、不暴露给 AI tool 列表，用于改版后定位 DOM 结构变化或抓 XHR 形态：

| CLI | 用途 |
|---|---|
| `node index.js dom-dump [--anchors] [--limit N]` | 一次性 snapshot 当前 reddit tab 上的关键 DOM 节点（`shreddit-post` / `shreddit-comment` / `[data-testid]` / `[id^=thing_]` / `faceplate-tracker`），输出 tag/id/class/testid + text outline；`--anchors` 加 `a[href]` |
| `node index.js xhr-log [--filter <regex>] [--limit N]` | 读 `performance.getEntriesByType('resource')`，过滤 reddit.com 命中条目，按 pathname 聚合；不写 listener / 不挂 hook，纯读浏览器 buffer |
| `node scripts/_dev-probe-login.js` | 一次性 dump 当前 tab 的 cookie flag / `/api/v1/me.json` 实响应 / shreddit 登录态指示元素，给 `loggedIn:false` 误判排错用；shreddit 改版导致 `readLoginStateDom` 选择器全失效时优先跑这个 |
| `node scripts/_dev-probe-anchor.js [--sub <name>] [--sort <hot|new|top>]` | 一次性 dump r/<sub>/<sort> 列表页的 anchor selector 命中表（候选 selector 各自命中数 + 抽样 outerHTML + rect/inVP）+ 每个 t3_xxx 在 `_visual-reddit.js::resolvePost` 三档候选下的命中状态。给"录像里 flash 事件全失"排错用。报告写到 `/tmp/jse-probe-anchor-<ts>.md` |

这三条都不写 listener、不挂 hook，纯靠浏览器内置 buffer / 一次性 querySelector，可放心反复跑。

## CLI

```bash
cd /Volumes/home_x/github/my/js-eyes/skills/js-reddit-ops-skill
npm install

# 通路 + 登录态 + bridge 注入 + probe + state 一站诊断
node index.js doctor

# READ：帖子详情（v2.x 兼容入口，调用 lib/api.js::getPost，内部 bridge 主路径 + DOM 兜底）
node index.js post https://www.reddit.com/r/programming/comments/abc/title/ --depth 4 --limit 50 --pretty

# READ：subreddit 列表 / about
node index.js list-subreddit programming --sort hot --limit 25
node index.js list-subreddit programming --sort top --time-range week --limit 50
node index.js subreddit-about programming

# READ：搜索
node index.js search "node.js" --sort top --time-range week --limit 25
node index.js search "lockfile" --sub programming   # restrictSr=true

# READ：用户主页
node index.js user-profile spez --user-tab overview --limit 25
node index.js user-profile spez --user-tab submitted

# READ：收件箱（必须已登录）
node index.js inbox-list --box unread --limit 25

# READ：主 feed
node index.js my-feed --feed popular --sort hot
node index.js my-feed --feed all --sort top --time-range day

# READ：登录态
node index.js session-state

# READ：展开评论树 more 节点
#   1) 先 reddit_get_post 拿到 _kind:'more' 节点的 _children + parent 上下文
#   2) 再 reddit_expand_more 提交 link_id + children
node index.js post https://www.reddit.com/r/<sub>/comments/<id>/<slug>/ --pretty
node index.js expand-more t3_<id> "child1,child2,child3" --sort top --pretty

# INTERACTIVE：仅 location.assign，不模拟点击
node index.js navigate-subreddit programming --sort top --time-range week
node index.js navigate-post https://www.reddit.com/r/programming/comments/abc/title/
node index.js navigate-search "node.js" --sub programming
node index.js navigate-user spez --user-tab overview
node index.js navigate-inbox --box unread
node index.js navigate-home --feed popular

# 内部踩点（仅本仓库开发者用）
node index.js dom-dump --anchors --limit 80
node index.js xhr-log --filter "reddit\\.com/(api|svc|graphql)" --limit 200

# 业务脚本（README + 业务结果落 docs/_data/）
node scripts/aggregate-subreddit.js programming --sort hot --limit 10 --depth 3
node scripts/batch-post.js --file urls.txt --depth 3 --comment-limit 80

# 也可通过 js-eyes 统一入口
js-eyes skill run js-reddit-ops-skill doctor
```

### DOM/API 双模式（v3.7.0+）

v3.7.0 把 6 个 page bridge 从"API-only（`fetchRedditJson`）"扩成"DOM/API 双
路径"，给每个 READ 命令多了一个 `--mode dom|api|auto` flag：

| 模式 | 行为 | 典型用途 |
|---|---|---|
| `auto`（默认） | DOM 优先，遇 `dom_*` 失败 fallback `api_*` | 录像 / 调研，前台肉眼可见的鼠标 / 输入 / 滚动 / 点击 |
| `dom` | 强制 DOM 路径，失败即报错 | 调试 selector 漂移、追求 100% 真实交互的录像 |
| `api` | 强制 reddit JSON API 路径（v3.6 行为） | CI / 批量 / 静默模式，速度优先 |

DOM 路径下每步真实操作都通过 `__jse_visual.emit` 发 `dom_*` 事件
（`dom_navigate` / `dom_locate` / `dom_hover` / `dom_click` / `dom_type` /
`dom_typed` / `dom_scroll` / `dom_wait` / `dom_extract`）进 events.jsonl，
配合 v3.8.0 的截图链路，`@js-eyes/visual-replay-hyperframes` v0.6.0+ 直接用
**真实 reddit 截图序列**承载这些操作的视觉表现（鼠标 / 输入 / 滚动 / 点击都已被
浏览器真实绘制并截进 JPEG）。`dom_*` 事件主要给上游审计 / 调试 selector 漂移用，
v0.5.x 那种合成端 cursor / typing / ripple / spinner / scroll 已下线（snapshot
主链路覆盖了同等视觉需求）。

response 里多 5 个字段方便上游审计：

```js
{
  ok: true,
  mode: 'dom',           // 实际跑通的档
  requestedMode: 'auto', // 用户请求的档
  fallback: false,       // true = auto 模式从 dom fallback 到 api
  triedMethods: ['dom_search', 'api_search'],
  usedMethod: 'dom_search',
  // ...原有字段
}
```

支持矩阵（v3.7.0 完整覆盖）：

| 工具 | DOM | API | 默认 |
|---|---|---|---|
| `list-subreddit` | ✓ | ✓ | auto |
| `subreddit-about` | ✓ | ✓ | auto |
| `search` | ✓ | ✓ | auto |
| `user-profile` | ✓ | ✓ | auto |
| `inbox-list` | ✓ | ✓ | auto |
| `my-feed` | ✓ | ✓ | auto |
| `session-state` | ✓ | ✓ | auto |
| `get-post` | ✓ | ✓ | auto |
| `expand-more` | — | ✓ | api |
| `navigate-*` | — | ✓ | api |

未实现 DOM 路径的命令仍然只走 `api_*`（向后兼容）。所有公开方法都同时挂
`api_<name>` 前缀别名，旧无前缀调用零改动继续工作。

selector 漂移诊断：

```bash
node skills/js-reddit-ops-skill/scripts/_dev-probe-dom.js --page subreddit
node skills/js-reddit-ops-skill/scripts/_dev-probe-dom.js --all
```

### snapshot mode 录像（v3.8.0+）

v3.8.0 起 `--visual-record <dir>` 自动启用 PNG/JPEG 截图链路（默认 JPEG q=82
按浏览器实际视口 CSS 像素），每条命令边界落 1 帧到 `<dir>/frames/<ts>.jpg`，
对应 `frame` 事件随 `events.jsonl` 一并写出（含 `viewport / when / frameRef`）。

`@js-eyes/visual-replay-hyperframes` v0.6.0 据此把 composition.html 的 `#stage`
背景换成真实 reddit 截图序列（双缓冲 cross-fade 220ms）。bridge 录制时画在浏览器
里的 HUD/flash 浮层会随 `captureScreenshot` 一起被拍进 JPEG 像素，**那是预期**——
合成端 (`visual-replay-hyperframes`) 默认不再额外叠一层 composition-side HUD/flash
（避免双重画 HUD 的视觉冗余）。

| flag | 行为 |
|---|---|
| `--no-frames` | 关闭截图（CI / 性能敏感）；hyperframes 自动退模板模式 |
| `--frames` | 显式启用（默认行为） |
| `--hi-dpi` | 截设备像素（4× 大但 retina 清晰） |
| `--max-frames N` | 单 session 帧数上限（默认 80；16 步典型 ≈ 50 帧） |

| `jse-replay` flag | 行为 |
|---|---|
| `--snapshot=auto`（默认） | events 含 `frame` 走 snapshot；否则退模板 |
| `--snapshot=never` | 强制走模板路径（list/item 卡片兜底） |
| `--effects=auto`（默认） | snapshot=none, template=hud+flash（mode-aware） |
| `--effects=hud,flash` | snapshot 之上 opt-in 叠合成端 HUD/flash overlay |
| `--no-effects` | 强制 0 effects（即使 template 模式也压住 HUD） |

> **v0.6.0 breaking**：`--shell` / `--no-shell` 已删；`--effects=cursor|typing|click|ripple|spinner|scroll`
> 报 `unknown effect` 退出 1。snapshot 模式截图自带 chrome 与 dom 操作的视觉表现，
> 这些 v0.5.x flag 已无对应渲染源。回退请用 0.5.2。

性能：每条命令额外 ~200-500 ms 等截图 + 写盘；典型 16 步深度调研 < 50 MB / 总耗时 < 5 min。

### 页面内视觉反馈（v3.5.0+）

reddit-ops 在调度边界自动给每个工具调用做"屏幕内演出"——这套层位于 `@js-eyes/visual-bridge-kit`，未来其它技能也能复用。bridge 业务函数零侵入。

> **post-2.7.0 architecture pivot**：在线视觉反馈（HUD / flash / relation）保持不变；
> 离线 `--visual-record` 已切到 HTML 数据驱动模式：`events.jsonl` 不再带
> `viewport / anchor.rect / frameRef`，而是按 `hint.kind` 在 `after` event 上挂 `payload`
> （list/item/tree/global/navigation 五种 shape）。`@js-eyes/visual-replay-hyperframes`
> 按 `payload` 渲 reddit-style 卡片视频。详见
> [`docs/dev/visual-cookbook.md`](docs/dev/visual-cookbook.md)。
> `--redact-rect / --redact-selector / --redact-config / --visual-record-frames /
> --visual-frames-throttle` 仍解析但**不会下发**，stderr 会打一行 deprecation 提醒。

```bash
# 默认开启：staged 详细级别，flash + HUD + 列表呼吸感 + 评论树 relation 线
node index.js list-subreddit AskReddit --limit 8

# 仅 HUD（不在页面 DOM 上画 box）
node index.js search "nodejs" --visual-mode hud

# 关掉视觉，回到 3.4.x 的纯日志风格
node index.js my-feed --no-visual

# 把视觉事件流落到 jsonl，CI 可重放
node index.js expand-more t3_xxx "c1,c2" --visual-trace runs/visual-2026-05-02.jsonl

# 写会话包目录（meta.json + events.jsonl + payload）→ jse-replay 渲视频
node index.js list-subreddit MachineLearning --limit 8 --visual-record runs/pivot-list
```

| flag | 默认 | 说明 |
|---|---|---|
| `--visual` / `--no-visual` | 开 | 总开关 |
| `--visual-detail compact\|staged` | `staged` | `compact` 只 HUD，`staged` 含 flash + relation |
| `--visual-ms <n>` | `420` | flash 持续 ms |
| `--visual-mode auto\|dom\|hud\|both\|off` | `auto` | DOM 锚点解析策略；`auto` 找不到就降级 HUD |
| `--visual-trace <file>` | — | 把事件流写 jsonl |
| `--visual-list-stride <ms>` | `90` | 列表呼吸感步进 |
| `--visual-prefix <p>` | `__jse_reddit_visual_` | DOM id 前缀（多 skill 共存防撞） |

防御要点：

- 永远不拦 reddit 自家点击（`pointer-events: none`）。
- 默认不 `scrollIntoView`：reddit 列表是虚拟滚动，强行滚会让虚表回收别的卡片；元素不在视口自动降级 HUD。
- z-index 取 `2147483000`，比 reddit dialog 低一档，不挡 site UI。
- 监听 `pushState`/`replaceState`/`popstate` 自动 `cleanup()`，shreddit SPA 路由切换不留残影。

## 架构概要

```text
CLI / AI Tool call
  └── skill.contract.js  (createRuntime / TOOL_DEFINITIONS)
        ├── lib/api.js          兼容入口（reddit_get_post → scrapeViaBridge → DOM 兜底）
        ├── lib/runTool.js      新 READ 工具入口（history + debug bundle，不走 cache）
        └── lib/session.js      Session（connect → resolveTarget → ensureBridge → callApi）
              ├── lib/config.js          PAGE_PROFILES + DEFAULT_WS_ENDPOINT
              ├── lib/js-eyes-client.js  BrowserAutomation
              └── bridges/*-bridge.js    + bridges/common.js (@@include)
                      └── fetchRedditJson('*.json' / oauth.reddit.com)
                          └── 失败时由 lib/redditUtils.js 用 cheerio DOM 兜底（仅 reddit_get_post 走）
```

### Page profiles

| profile | targetUrlFragment | bridgeGlobal | bridgePath |
|---|---|---|---|
| `post` | `reddit.com/<sub>/comments/<id>/` | `__jse_reddit_post__` | `bridges/post-bridge.js` |
| `subreddit` | `reddit.com/r/<sub>` 但排除 `/comments/` | `__jse_reddit_listing__` | `bridges/listing-bridge.js` |
| `search` | `reddit.com/search` 或 `/r/<sub>/search` | `__jse_reddit_search__` | `bridges/search-bridge.js` |
| `user` | `reddit.com/user/<name>` | `__jse_reddit_user__` | `bridges/user-bridge.js` |
| `inbox` | `reddit.com/message/` | `__jse_reddit_inbox__` | `bridges/inbox-bridge.js` |
| `home` | `reddit.com/`、`/r/popular`、`/r/all` | `__jse_reddit_home__` | `bridges/home-bridge.js` |

URL 片段重叠（例如 `/r/<sub>` 既可能是 subreddit 列表也可能下钻到 `/comments/`）由 `pickTabMatchingFragment` 评分函数解决；每个 profile 给自己最贴切的 path 加 +500 分，`is_active` 加 +1000。

### Bridge 热更新

每个 bridge 顶部维护 `const VERSION = 'x.y.z'`。`session.ensureBridge()` 会读当前 bridge 的 `__meta.version`，不一致时重注。共享 helpers 写在 `bridges/common.js`，通过 `// @@include ./common.js` 在注入前内联（不是运行时 require），所以所有 helpers 仍然是纯浏览器 JS。

每个 bridge 都暴露 `__meta = { version, name }` / `probe()` / `state()` / `sessionState()` / `navigateXxx()` 五件套，加上各自的 READ 主方法。

### 大响应保护与登录态判定

- **登录态**：`readMeViaApi()` 优先走 `/api/v1/me.json`；超时或非 JSON 时回退 `readLoginStateDom()`（shreddit 用 `faceplate-dropdown-menu[noun=user-drawer]`，old 用 `#header .user a`）。任一失败返回 `{loggedIn:false}`，**绝不抛错**
- **评论树深度截断**：`reddit_get_post` 加 `depth` 默认 8 / 上限 20；`limit` 默认 500 / 上限 1000；超限 `more` 节点保留 marker `{ _kind:'more', _children, _count }`
- **列表分页**：所有 listing 工具支持 `after` 游标 + `limit` 默认 25 / 上限 100；返回 `{ items, after, before, returnedCount, dist, meta.truncated }`
- **图片/媒体**：只回 url + 尺寸 meta，不内联 base64；命中 `pickImageUrlsFromPost` 白名单（`i.redd.it` / `preview.redd.it` / `external-preview` / `media_metadata` / `preview.images`）
- **非 JSON 响应**：bridge 端只回 `{status, contentType, text:snippet, truncated, length}`，避免大 HTML 跨进程传递
- **Frontend 探测缓存**：`detectFrontend()` 按 `location.href` 缓存到 bridge module scope，避免每次 fetch 都 walk DOM

### 为什么 JSON-first / DOM-fallback（v3.0 决策）

v2.x 单纯靠 cheerio 解析 reddit 帖子页 HTML。v3.0 起改成 JSON-first，原因：

- **稳定性**：reddit 公开 `*.json` 端点 schema 长期稳定（与 `https://www.reddit.com/dev/api/oauth` 一致），DOM 改版（shreddit 持续在改）会让 cheerio 选择器失效
- **同源 cookie**：bridge 在任意 reddit.com tab 里 `fetch('/r/foo/.json', {credentials:'include'})` 自动带 reddit_session / token_v2，未登录走匿名限流，登录后无需 OAuth bearer
- **覆盖范围**：subreddit / search / user / inbox / home 这五个 profile 的 listing 形态完全一致（都是 `{kind:Listing, data:{children:[…], after, before}}`），共用一份 `summarizeListing` + `normalizeXxxItem`
- **fallback 必要**：单帖详情 schema 复杂、需要展开评论树 `more` 子节点，DOM 解析路径仍保留作为 bridge 失败时的兜底；`JS_REDDIT_DISABLE_BRIDGE=1` 可强制走 DOM 路径调试，`JS_REDDIT_DISABLE_FALLBACK=1` 可让 bridge 失败直接抛错（用于 CI 验证 bridge 正确性）

## 启用方式

1. `cd /Volumes/home_x/github/my/js-eyes/skills/js-reddit-ops-skill && npm install`
2. `js-eyes skills link /Volumes/home_x/github/my/js-eyes/skills/js-reddit-ops-skill`
   - 会追加到 `~/.js-eyes/config/config.json` 的 `extraSkillDirs`
   - 会把 `skillsEnabled["js-reddit-ops-skill"] = true`
3. `js-eyes skills reload`（OpenClaw 插件 300ms 内热载）
4. `js-eyes skills list` 应看到 `Source: extra (...skills/js-reddit-ops-skill)`
5. **浏览器里至少打开一个 reddit.com tab**（READ 默认不会切走当前 tab；INTERACTIVE 会主动切到目标 URL）
6. `js-eyes doctor` 确认整体安全态

卸载：`js-eyes skills unlink /Volumes/home_x/github/my/js-eyes/skills/js-reddit-ops-skill`

## 明确不做的事

这些是 skill 在任何版本都不会做的事（DESTRUCTIVE 档位），避免后续补能力时跑偏：

- 不投票 / 不评论 / 不发帖 / 不编辑 / 不删除（vote / submit / comment / edit / delete）
- 不 save / unsave / hide / report
- 不 follow / unfollow / subscribe / unsubscribe / block / mute
- 不发送 / 标记已读 / 删除私信（compose / read_message / del_msg）
- 不模拟点击任何 DOM CTA；所有 INTERACTIVE 都走 `location.assign`
- 不实现 OAuth 登录自动化、不注入 cookie、不伪造 modhash / bearer token
- 不做扫码 / captcha 自动化
- 不使用未在浏览器里实际发生过的 XHR 端点；改版前先用 `xhr-log` / `dom-dump` 踩点

## 路线图

- v2.0：单工具 `reddit_get_post`，DOM 解析（cheerio）单文件实现
- **v3.0**：架构升级到 `PAGE_PROFILES + Bridges + Session`，post bridge 走 JSON 主路径 + DOM 兜底；新旧 schema 字段级一致（`scripts/_dev/diff-post-schema.js` 验证）
- **v3.1**：扩展 listing / search / user / inbox / home 五个 READ profile + `reddit_session_state`；每个 bridge 加 `probe` / `state` / `VERSION` 热更新；列表工具加 `limit` / `after` / `total/returned` 截断字段
- **v3.2**：INTERACTIVE 档位：每个 bridge 加 `navigateXxx`（仅 `location.assign`）；CLI 抽 `runNavigate` 公共流程；`awaitBridgeAfterNav` 重注 bridge + state 自校验
- **v3.3**：doctor 一站诊断 + dom-dump / xhr-log 内部踩点 CLI；业务脚本 `aggregate-subreddit.js` / `batch-post.js`；SKILL.md 改版（依赖前置 / 安全红线 / 工具表 / CLI / 架构 / 不做的事 / 路线图 / 故障排查）
- **v3.4**：`reddit_expand_more`（`/api/morechildren`）真正闭环评论树；`lib/api.js::FALLBACK_REASON` 把 `bridgeFallbackReason` 标准化成稳定枚举；`docs/dev/bridges-cheatsheet.md` 给开发者的速查表
- **v3.4.1**：联机烟测验出三处真 bug 并修复 —— ① `lib/js-eyes-client.js` 缺 token 解析（server `allowAnonymous=false` 时握手 401），补齐 `options.token` / `JS_EYES_TOKEN` / `~/.js-eyes/runtime/server.token` / `~/.js-eyes/secrets/server-token` 四档优先级及 `Origin: http://localhost` header；② `post-bridge.js` 把 `author_id` 错误地塞成 username，改用 `post.author_fullname`（`t2_xxx`）；③ `common.js::buildCommentTree` 的 `_kind:'more'` marker 缺 `_parent_id`、`depth` 没用 reddit 给的真值；同时去掉 `pickImageUrlsFromPost` 里 `is_gallery` 的硬限制，让 self post 的 inline `media_metadata` 也能出图；`user-bridge.js::userProfile` 顺手并发拉 `/user/<name>/about.json`，response 里直接带 `about` 字段；所有 bridge VERSION 一并 bump 到 `3.4.1`
- **v3.4.2**：工程化补丁，**runtime 行为不变**，全部是开发者侧脚手架 —— ① `lib/runCliToFile.js`：封装 `child_process.spawn` 用 `stdio:['ignore', fd, 'pipe']` 直写 fd，绕开 Node 在 stdout `>64KB` 时通过 `child.stdout.pipe(fs.createWriteStream)` 会丢尾的坑（实测 118913B / 50 条 search 结果完整落地）；② `scripts/_templates/{batch-search.js, fetch-samples.js, README.md}`：把"批量 search 矩阵 → 严格关键词过滤 → 拉评论树"调研三步法抽成可 cp 修 query 即跑的脚手架，已用 1 条真实 query + 1 个真实 post id 双向冒烟通过；③ `docs/dev/bridges-cheatsheet.md` 加「实用工具（lib/）」段，并补两条故障排查（`Session::callRaw` 内 `fetch` 必须传绝对 URL 否则扩展隔离上下文里抛 `... is not a valid URL`；spawn stdout 64KB 截断改用 `runCliToFile`）。bridge `VERSION` 不动（不涉及浏览器端注入）
- **v3.5.0 / v3.6.0**：见 CHANGELOG（visual-bridge-kit 接入 + Phase 2 录像）
- **v3.7.0（当前版本）**：DOM-first 重构 —— 6 桥从"API-only `fetchRedditJson`"
  扩成"DOM/API 双路径"，CLI 加 `--mode dom|api|auto` flag；`runTool.js` 按
  `cmdDef.domSupported / apiSupported` 决定 `tryOrder`，auto 模式遇
  `dom_*` 失败码自动 fallback `api_*`；新建 `bridges/_dom-actions.js` 提供
  `__jseDomLocate / WaitFor / ScrollIntoView / Click / Type / Extract` 共享
  工具，每步 emit `dom_*` 事件（`dom_navigate` / `dom_locate` / `dom_hover` /
  `dom_click` / `dom_type` / `dom_typed` / `dom_scroll` / `dom_wait` /
  `dom_extract`）进 events.jsonl；DOM 桥碰到当前页 URL 与目标不符直接报
  `dom_navigation_required`，runTool 先 drain 再调对应 `navigate*` API 切页、
  等 bridge 重灌、retry 同一 `dom_*`（最多 1 次），保住 `dom_navigate` /
  `dom_type` 不被页面卸载吞掉。`@js-eyes/visual-replay-hyperframes` v0.4.0
  识别新事件流，离线 composition 渲连续鼠标轨迹 + 打字机 + click 波纹 +
  spinner + scroll 平移。验收：14 步深度调研 `--mode auto` 重录 fallback
  比例 14% / `dom_navigate` 10 / `dom_type` 75 / flash 99；老 session 重渲
  零回归。bridge VERSION 3.5.4→3.6.0（search 3.6.1）。
- **v3.6.3**：修登录态下 reddit 录像 0 条 flash 事件 —— 用 `scripts/_dev-probe-anchor.js` 探针锁定三根因：①主因 B（offVP）：登录态 r/<sub>/hot 列表 6 个 t3_xxx 中 5 个首屏外，`flashElement::isInViewport` reject 不发 flash 事件；②次因 A（selector 过期）：`bridges/_visual-reddit.js::resolvePost` 老 fallback `article[data-test-id*="..."]` / `a[data-click-id="body"]` 在新 shreddit 列表页 0 命中（实际 DOM 是 `article[data-post-id]` + `a[data-ks-id]`）；③隐性根因 C（page 不导航 + Firefox 后台 tab setTimeout 1Hz 节流）：reddit-ops 用 fetch 不做 location.assign，搜索结果的 t3_xxx 在当前 tab DOM 上 0 命中是常态，加上 stagger 90ms × N 的 setTimeout 几乎全漂到下次 drain。修复仅改 `bridges/_visual-reddit.js`：①resolvePost selector 链重排（`shreddit-post[id]` → `article[data-post-id]` → `a[data-ks-id]` → `[data-fullname]` → legacy）；②staggerFlashItems 重写两阶段——阶段 1 同步 for-loop 立刻 emit N 条语义 flash 进 ring buffer（drain 立即取走，零 timing drift），阶段 2 setTimeout 仍按 stride 散布做 scrollIntoView + flashElement 画 outline，互不阻塞；③resolveSubreddit 把精确匹配 `a[href="/r/<sub>"]` 前置。bridges VERSION 3.5.2→3.5.4 触发热重注，visual-bridge-kit 不动。验收：v3 重录 flash 事件总数 67（≥30 阈值，超额 2.2x），探针补跑 selector 仍稳。
- **v3.6.2**：修 visual 录像中 `reddit_subreddit_about` 信息卡几乎全空 —— 根因是 `lib/visualHint.js::extractPayload` 不识别 reddit-ops bridge 的二层 wrap 结构 `{sub, data:{真字段}, meta}`，`pickSingleItem` 全部 miss → 走 `extractGlobalFields(data)`，`Object.keys(data) = [sub, data, meta]` 里 `data/meta` 因为是对象被跳过、只剩 `sub` 一条进 fields。修复：`pickSingleItem` 兜底分支识别 `data.data` 非数组对象；`extractGlobalFields` 把 `data.data` 当 primary 源平铺，扫两轮（primary 自己 + 顶层 `sub` 等元字段）；`ordered` 关键字段表补 reddit-ops bridge 实际产出的 camelCase（`displayName / prefixed / activeUserCount / createdUtc / subredditType / publicDescription`）。配套 `@js-eyes/visual-replay-hyperframes` patch bump：`templates/reddit/list.js` sub-title 加 `hint.label` 兜底（全站 search 不再显示死值 `reddit`）、`templates/reddit/item.js::renderInfoCard` 加 hero metric 区块。bridge `VERSION` 不动，全部修改在 Node 端。
- **v3.6.1**：修 firefox 上"已登录但 doctor 报 loggedIn:false"双爆 bug —— ① 根因 A：扩展 isolated world 里 `fetch /api/v1/me.json` 经常被 reddit 当 anonymous 处理（cookie partitioning / 反扩展指纹），response 200 但 body 只含 `features`、没 `name`；② 根因 B：shreddit 2025-2026 又改版，`bridges/common.js::readLoginStateDom` 的 `faceplate-dropdown-menu[noun=user-drawer]` 等老选择器全部失效。修复仅改 `bridges/common.js`：`readLoginStateDom` 加 `community-author-flair[username] / achievements-entrypoint[username] / after-login-toast-dispatcher[username]` 三选一作为首选检测，加 `button#expand-user-drawer-button` 作为兜底；`sessionStateCommon` 改 DOM-first fast path，API 退到 DOM 兜不住时的后路。6 bridge VERSION → 3.5.2，触发自动重注。新增 `scripts/_dev-probe-login.js` 内部踩点。真正修扩展层 fetch 带 cookie 留待后续 minor。
- 一直不会做：见「明确不做的事」

## Recording

`js-reddit-ops-skill` 全程接入 `@js-eyes/skill-recording`，每次工具调用都进同一套 history / cache / debug 流水。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- 可通过 CLI 覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`（仅 `post` 命令进 cache；其它 READ 工具走 `lib/runTool.js`，不带 cache）
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-reddit-ops-skill/`：

- `history/`：按月滚动的 `tool_calls.jsonl`
- `cache/`：`reddit_get_post` 结构化抓取结果缓存
- `debug/`：调试模式下的步骤时间线、target / bridge meta 与结果快照

## 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `E_NO_TAB` | 浏览器没打开任何 reddit.com tab | 在浏览器里打开 `https://www.reddit.com/` 任一页面；CLI 的 INTERACTIVE 命令默认会自动开新 tab，READ 命令默认 `createIfMissing=true` 也会兜底 |
| `RAW_EVAL_DISABLED` | 一侧 `allowRawEval=false` | 宿主 `~/.js-eyes/config/config.json` 的 `security.allowRawEval` + 扩展 popup 的 `Allow Raw Eval` 都要打开 |
| `not_logged_in`（inbox / saved 等） | 未登录或会话过期 | 在浏览器里登录 reddit.com；或先跑 `node index.js session-state` 自检 |
| `fetch_failed`（httpStatus=429） | 公开 JSON 端点对未登录限流 | 等几秒重试，或先登录后再跑（同一 bridge 的 fetch 会自动带 reddit cookie） |
| `fetch_failed`（httpStatus=403 / privatesubreddit） | 该 sub 是 private / quarantined / 被禁 | 这是 reddit 业务层限制，不是 bug；跑 `subreddit-about` 看 `subredditType` 字段 |
| `bridge_not_installed` / `method_not_found` | bridge VERSION 可能未 bump | 改 bridge 后 bump VERSION，CLI 会自动重注；或 `JS_REDDIT_DEBUG=1 node index.js probe -v` 看注入流程 |
| `cross_origin_navigation_forbidden` | INTERACTIVE 调用传了非 reddit.com URL | 这是硬约束（`navigateLocation` 拒绝跨域）；只能传 `*.reddit.com` |
| post / 评论字段缺失 | bridge JSON 主路径返回不完整 | `JS_REDDIT_DISABLE_BRIDGE=1 node index.js post <url>` 强制走 cheerio DOM 兜底；如果 DOM 路径有数据就是 bridge schema 退化，需要更新 `bridges/post-bridge.js` |
| `awaitBridgeAfterNav` 超时 | navigate 之后页面 reload 慢 / state 长时间不 ready | 增大 `--verbose` 看 stderr；或先 `node index.js state` 看当前 bridge state.ready 字段 |
| `loggedIn: false` 但浏览器里实际已登录（尤其 firefox） | bridge 版本 < 3.5.2：①shreddit 改版导致 user drawer 老选择器全失效；②扩展 isolated world fetch `/api/v1/me.json` 被 reddit 当 anonymous，body 只含 `features` 字段 | 升级 skill ≥ 3.6.1（bridge ≥ 3.5.2）即可，重注后 `readLoginStateDom` 走 DOM-first fast path。若仍误判：跑 `node scripts/_dev-probe-login.js` 看 `genericLoginEls` / `usernameEls`，确认 shreddit 又改版（再补选择器） |
| visual 录像里 `subreddit_about` / `session_state` 等信息卡几乎全空（只有一行 `sub=xxx`） | skill 版本 < 3.6.2：`lib/visualHint.js::extractPayload` 不识别 reddit-ops bridge 的二层 wrap `{sub, data:{真字段}, meta}`，`pickSingleItem` 全部 miss → 走 `extractGlobalFields(data)` 时 `data/meta` 因为是对象被 `push()` 跳过 | 升级 skill ≥ 3.6.2（同时 `@js-eyes/visual-replay-hyperframes` ≥ 0.1.1）；老会话包仅重渲不会改善（`payload` 已写死在 `events.jsonl`），需要重录一次。可用 `JS_REDDIT_DEBUG=1` 加 `--visual-record /tmp/probe` 跑 `subreddit-about MachineLearning`，再 `head -1 /tmp/probe/events.jsonl | jq '.payload.fields'` 验证字段是否平铺出来 |
| visual 录像 events.jsonl 里 0 条 flash 事件（登录态尤其严重，匿名时正常） | skill 版本 < 3.6.3：①登录态 shreddit 列表 5/6 帖子在首屏外，`flashElement::isInViewport` reject 不发 flash；②`_visual-reddit.js::resolvePost` 老 fallback `article[data-test-id]` / `a[data-click-id]` 在新 shreddit 0 命中 | 升级 skill ≥ 3.6.3（bridge ≥ 3.5.2 自动触发重注）。诊断：跑 `node scripts/_dev-probe-anchor.js --sub <sub>` 看候选 selector 命中表，重点关注 `article[data-post-id]` / `a[data-ks-id]` 是否仍命中、t3_xxx 的 `inVP` 比例。验证：`jq '.events[]?|select(.type==\"flash\")|length' .../events.jsonl` 应 ≥ 30 |
