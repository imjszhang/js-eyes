---
name: js-x-ops-skill
description: X.com (Twitter) 内容只读 + 浏览器导航 skill：搜索 / 用户主页 / 推文详情 / 首页 Feed，全部走 X.com 内部 GraphQL 同源端点（DOM 兜底），浏览器侧仅 location.assign 改 URL；写操作（reply/post/quote/thread）保持 v2.0.1 透传，v3.1 将拆到专用工具。
version: 3.0.4
metadata:
  openclaw:
    emoji: "\U0001F50D"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      skills:
        - js-eyes
      bins:
        - node
    platforms:
      - x.com
      - twitter.com
---

# js-x-ops-skill

面向 x.com / twitter.com 的 skill。v3.0 起切到 `PAGE_PROFILES + Bridges + Session` 架构，参考 `js-reddit-ops-skill` 的设计取舍：

- **数据获取**：READ 数据优先走 X.com 内部 GraphQL 同源端点（`/i/api/graphql/<queryId>/<op>`），与浏览器同源、复用 cookie + bearer；DOM 解析（`bridges/common.js::parseTweetArticle`）保留为兜底
- **safety 分级**：READ + INTERACTIVE 已经落地；DESTRUCTIVE（reply / post / quote / thread）目前透传 v2.0.1 的 `scripts/x-post.js`，**v3.1 拆 compose-bridge 后将走 `--confirm` + 默认 `--dry-run`**

## 依赖与前置

- **JS Eyes Server**：已启动（`js-eyes server start`）
- **浏览器扩展**：已安装并连上 server
- **登录态**：浏览器里已经人工登录 x.com（本 skill 不做任何登录自动化）；READ 工具默认 `navigateOnReuse=false / reuseAnyXTab=true`，bridge 在任意 x.com / twitter.com tab 里 fetch 同源 GraphQL；用户当前 tab 不会被切走
- **双侧 `allowRawEval`**：bridge 首次注入会走一次 `bot.executeScript(rawSource)`；之后每次工具调用只执行 `window.__jse_x_*__.<method>()`
  - 宿主：`~/.js-eyes/config/config.json` 里 `security.allowRawEval: true`
  - 扩展：js-eyes 扩展 popup 里 `Allow Raw Eval` 打开
  - 少一侧会返回 `RAW_EVAL_DISABLED`

## 安全红线（READ / INTERACTIVE / DESTRUCTIVE）

本 skill 的所有工具都会被归入以下三档之一。审计界线按「是否改 X 业务数据」而非「是否触网」来划：

### READ（默认档）

纯读，不改任何 DOM、不改 URL、不触发任何业务写操作。

- 走 `fetchXGraphQL(opName, vars, features)` 调 X.com 内部 GraphQL（GET，复用浏览器同源 cookie + 写死 bearer）
- DOM 路径仅作为 bridge 失败时的兜底，由 `bridges/common.js::parseTweetArticle / collectTweetsFromDom` 提供
- 工具：`x_search_tweets` / `x_get_profile` / `x_get_post` / `x_get_home_feed` / `x_session_state`

### INTERACTIVE（v3.0+）

**只改浏览器自己的 URL**，不改 X 侧任何业务数据。实现硬约束：

- 仅 `location.assign(newUrl)`，**禁止模拟点击任何 DOM CTA**
- bridge 端 `navigateLocation()` 拒绝跨域 URL（必须是 `*.x.com` / `*.twitter.com`）
- 调用返回 `{from, to, hint}`，CLI 端 `awaitBridgeAfterNav` 重注 bridge + state 自校验
- `skill.contract.js` 里带 `interactive: true` / `destructive: false`
- 工具：`x_navigate_search` / `x_navigate_profile` / `x_navigate_post` / `x_navigate_home`

### DESTRUCTIVE（v3.0 透传 v2 行为，v3.1 拆专用工具）

`x_get_post` 的 schema 里仍保留 `--reply / --post / --quote / --thread / --image / --thread-delay / --thread-max / --reply-style` 等写参数（v2.0.1 行为，CLI 透传 `scripts/x-post.js`），description 标 **deprecated**。等 v3.1 完成后：

- 拆 `bridges/compose-bridge.js`：DESTRUCTIVE 唯一入口
- 4 个独立工具：`x_create_tweet` / `x_reply_tweet` / `x_quote_tweet` / `x_create_thread`
- 默认 `--dry-run`，必须显式 `--confirm` 才落地
- 砍掉 `x_get_post` 的写参数

## 提供的 AI 工具

| 档位 | 工具 | 页面 | 说明 |
|---|---|---|---|
| READ | `x_search_tweets` | `/search?q=` | 搜索：keyword / sort / maxPages / since / until / lang / from / minLikes / minRetweets / excludeReplies / excludeRetweets |
| READ | `x_get_profile` | `/<username>` | 用户主页时间线：username / maxPages / includeReplies / since |
| READ | `x_get_post` | `/<user>/status/<id>` | 推文详情：tweetInputs / withThread / withReplies；同时 v2 写参数透传（**deprecated**，v3.1 拆专用工具） |
| READ | `x_get_home_feed` | `/home` | 首页 Feed：feed=foryou/following / maxPages |
| READ | `x_session_state` | 任意 X tab | 登录态（cookie + `/i/api/1.1/account/settings.json`） |
| INTERACTIVE | `x_navigate_search` | `/search?q=&f=` | 仅 `location.assign` 切搜索页 |
| INTERACTIVE | `x_navigate_profile` | `/<username>[/with_replies]` | 仅 `location.assign` 切用户主页 / with_replies tab |
| INTERACTIVE | `x_navigate_post` | `/i/status/<id>` | 仅 `location.assign` 切推文详情 |
| INTERACTIVE | `x_navigate_home` | `/home[/following]` | 仅 `location.assign` 切首页 + feed |

全部工具都是 `optional: true`（按需加载），入参详见 `skill.contract.js::TOOL_DEFINITIONS`。

### 内部踩点 CLI（不进 `skill.contract.js`，仅供本仓库开发者排查）

下面两条只在 CLI 暴露、不暴露给 AI tool 列表，用于改版后定位 DOM 结构变化或抓 XHR 形态：

| CLI | 用途 |
|---|---|
| `node index.js dom-dump [--anchors] [--limit N]` | 一次性 snapshot 当前 X tab 上的关键 DOM 节点（`article[data-testid="tweet"]` / `[data-testid]` / `[role="link"]`），输出 tag/id/class/testid + text outline |
| `node index.js xhr-log [--filter <regex>] [--limit N]` | 读 `performance.getEntriesByType('resource')`，过滤 `i/api/graphql/` 命中条目，按 pathname 聚合；不写 listener、不挂 hook，纯读浏览器 buffer |

## CLI

```bash
cd /Volumes/home_x/github/my/js-eyes/skills/js-x-ops-skill
npm install

# 通路 + 登录态 + bridge 注入 + probe + state 一站诊断
node index.js doctor

# READ：搜索
node index.js search "AI agent" --sort latest --max-pages 3
node index.js search "MCP" --since 2025-01-01 --until 2025-06-30 --min-likes 10

# READ：用户时间线
node index.js profile elonmusk --max-pages 5
node index.js profile karpathy --include-replies --max-pages 3

# READ：推文详情
node index.js post https://x.com/user/status/123 --with-thread
node index.js post https://x.com/user/status/123 --with-replies 50 --pretty

# READ：首页推荐
node index.js home --feed foryou --max-pages 3
node index.js home --feed following --max-pages 3

# READ：登录态
node index.js session-state

# INTERACTIVE：仅 location.assign，不模拟点击
node index.js navigate-search "AI agent"
node index.js navigate-profile elonmusk
node index.js navigate-post https://x.com/user/status/123
node index.js navigate-home --feed following

# DESTRUCTIVE（v2.0.1 行为透传，v3.1 拆专用工具）：
node index.js post --post "新帖内容"                                           # 发新帖
node index.js post --post "看看这张图" --image path/to/image.png                # 附带图片
node index.js post https://x.com/user/status/123 --reply "回复内容"             # 回复
node index.js post https://x.com/user/status/123 --reply "回复" --reply-style thread
node index.js post --post "评论" --quote https://x.com/user/status/123          # Quote
node index.js post --thread "段1" "段2" "段3" --thread-delay 2000               # 串推
node index.js post --post "test" --dry-run                                     # 不实际发送

# 内部踩点（仅本仓库开发者用）
node index.js dom-dump --anchors --limit 80
node index.js xhr-log --filter "i/api/graphql/" --limit 200

# 业务脚本（README + 业务结果落 docs/_data/）
node scripts/aggregate-profile.js elonmusk --limit 20 --with-replies
node scripts/batch-search.js --query "AI agent|top|2" --query "MCP|latest|1"

# 也可通过 js-eyes 统一入口
js-eyes skill run js-x-ops-skill doctor
```

## 编程 API

```javascript
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { searchTweets, getProfileTweets, getPost, getHomeFeed } = require('./lib/api');

const browser = new BrowserAutomation('ws://localhost:18080');

const result = await searchTweets(browser, 'AI agent', { maxPages: 3, sort: 'latest', minLikes: 10 });
const profile = await getProfileTweets(browser, 'elonmusk', { maxPages: 10, since: '2025-01-01' });
const post = await getPost(browser, 'https://x.com/user/status/123', { withThread: true, withReplies: 50 });
const feed = await getHomeFeed(browser, { feed: 'foryou', maxPages: 5 });
```

所有 API 函数接收 `BrowserAutomation` 实例，返回结构化 JSON，不做文件 I/O 或 `process.exit`。

### 推文详情返回字段（getPost / x_get_post）

`getPost` 返回的推文对象包含以下增强字段（v3.0 起 bridge 与老 fallback **字段对齐**，由 `scripts/_dev/diff-post-schema.js` 守护）：

| 字段 | 说明 |
|---|---|
| `quoteTweet` | 引用推文的完整信息（嵌套），无引用为 `null` |
| `card` | 链接预览卡片（`name`/`title`/`description`/`url`/`thumbnailUrl`/`domain`），无卡片为 `null` |
| `mediaDetails` | 增强媒体：照片含尺寸，视频含多质量 mp4/m3u8 + 时长 + 海报图 |
| `stats.quotes` | 引用数（与 replies/retweets/likes/views/bookmarks 并列） |
| `lang` | 语言代码 |
| `isVerified` | 作者蓝标认证 |
| `conversationId` | 对话线程 ID |
| `inReplyToTweetId` / `inReplyToUser` | 被回复对象 |
| `source` | 发推来源 |

> 注意：`searchTweets` / `getProfileTweets` / `getHomeFeed` 返回的推文结构较精简，不含 `quoteTweet`、`card`、`mediaDetails`。

## 架构概要

```text
CLI / AI Tool call
  └── skill.contract.js (createRuntime / TOOL_DEFINITIONS)
        ├── lib/api.js          兼容入口（4 个 READ + bridge-first with fallback）
        │     ├── lib/bridgeAdapter.js  调 bridge + 失败兜底回 scripts/x-*.js
        │     └── scripts/x-*.js        老 DOM 主路径（fallback only）
        ├── lib/runTool.js      新 READ 工具入口（history + debug bundle）
        └── lib/session.js      Session（connect → resolveTarget → ensureBridge → callApi）
              ├── lib/config.js          PAGE_PROFILES + DEFAULT_WS_ENDPOINT
              ├── lib/js-eyes-client.js  BrowserAutomation
              └── bridges/*-bridge.js    + bridges/common.js (@@include)
                      └── fetchXGraphQL('/i/api/graphql/...')
                          └── 失败时由 collectTweetsFromDom / parseTweetArticle DOM 兜底
```

### Page profiles

| profile | targetUrlFragment | bridgeGlobal | bridgePath |
|---|---|---|---|
| `search` | `x.com/search` | `__jse_x_search__` | `bridges/search-bridge.js` |
| `profile` | `x.com/<username>`（排除 `/status/` `/search` `/home` `/compose` `/i/`） | `__jse_x_profile__` | `bridges/profile-bridge.js` |
| `post` | `x.com/<user>/status/<id>` | `__jse_x_post__` | `bridges/post-bridge.js` |
| `home` | `x.com/home` 或 `x.com/`（排除 `/search` `/i/`） | `__jse_x_home__` | `bridges/home-bridge.js` |

URL 片段重叠由 `pickTabMatchingProfile` 评分函数解决；每个 profile 给自己最贴切的 path 加 +500 分，`is_active` 加 +1000，同域（x.com|twitter.com）+50。

### Bridge 热更新

每个 bridge 顶部维护 `const VERSION = 'x.y.z'`。`session.ensureBridge()` 会读当前 bridge 的 `__meta.version`，不一致时重注。共享 helpers 写在 `bridges/common.js`，通过 `// @@include ./common.js` 在注入前内联（不是运行时 require），所以所有 helpers 仍然是纯浏览器 JS。

每个 bridge 都暴露 `__meta = { version, name }` / `probe()` / `state()` / `sessionState()` / `navigateXxx()` 五件套，加上各自的 READ 主方法（`search` / `getProfile` / `getPost` / `getHome`）。

### 大响应保护与限流

- **GraphQL queryId 动态发现**：通过 `performance.getEntriesByType('resource')` 扫 `i/api/graphql/<queryId>/<op>` 结果缓存到 bridge module scope（TTL 12h）；429 / 4xx 时 `invalidateGraphQLCache(opName)` 强制重新发现
- **429 连续 3 次 → 暂停 5 分钟**：bridge 内置保护，避免账号被风控
- **登录态判定**：`sessionStateCommon()` 走 `/i/api/1.1/account/settings.json`，超时或非 JSON 时回退 `readLoginStateDom()`；任一失败返回 `{loggedIn:false}`，**绝不抛错**
- **媒体白名单**：`pickMediaFromTweet` 仅返回 `pbs.twimg.com` / `video.twimg.com` 域名下的资源
- **非 JSON 响应**：bridge 端只回 `{status, contentType, text:snippet, truncated, length}`，避免大 HTML 跨进程传递

### 为什么 GraphQL-first / DOM-fallback（v3.0 决策）

v2.x 单纯靠 DOM 解析 X 页面 HTML。v3.0 起改成 GraphQL-first，原因：

- **稳定性**：X.com 的 `i/api/graphql/<queryId>/<op>` schema 在同一 queryId 下相对稳定（按月级别变化），DOM 改版（X 持续在改）会让 selector 失效
- **同源 cookie + bearer**：bridge 在任意 x.com / twitter.com tab 里 `fetch('/i/api/graphql/...', {credentials:'include'})` 自动带 ct0 / auth_token，登录账号无需 OAuth flow
- **覆盖范围**：`UserTweets` / `TweetDetail` / `HomeTimeline` 共用同一种 timeline_v2 entries 结构，共用一份 `parseTweetEntries` + `parseSingleTweetResult`
- **fallback 必要**：`SearchTimeline` 偶发 404、queryId 偶发轮换；DOM 路径作为兜底保留。`JS_X_DISABLE_BRIDGE=1` 可强制走 DOM 路径调试，`JS_X_DISABLE_FALLBACK=1` 可让 bridge 失败直接抛错（用于 CI 验证 bridge 正确性）

## 启用方式

1. `cd /Volumes/home_x/github/my/js-eyes/skills/js-x-ops-skill && npm install`
2. `js-eyes skills link /Volumes/home_x/github/my/js-eyes/skills/js-x-ops-skill`
   - 会追加到 `~/.js-eyes/config/config.json` 的 `extraSkillDirs`
   - 会把 `skillsEnabled["js-x-ops-skill"] = true`
3. `js-eyes skills reload`（OpenClaw 插件 300ms 内热载）
4. `js-eyes skills list` 应看到 `Source: extra (...skills/js-x-ops-skill)`
5. **浏览器里至少打开一个 x.com tab 并完成登录**（READ 默认不会切走当前 tab；INTERACTIVE 会主动切到目标 URL）
6. `js-eyes doctor` 确认整体安全态

卸载：`js-eyes skills unlink /Volumes/home_x/github/my/js-eyes/skills/js-x-ops-skill`

## 明确不做的事

这些是 skill 在 v3.0 不会做的事；其中部分（reply/post/quote/thread）会在 v3.1 通过 compose-bridge + `--confirm` 引入：

- **v3.0 不做**：投票（like / unlike）/ 转推（retweet / unretweet）/ 关注（follow / unfollow）/ 屏蔽（block / mute）/ 收藏（bookmark）/ 私信（DM）/ 名单管理 / 报告（report）
- **v3.0 透传 v2.0.1**：发推 / 回复 / Quote Tweet / 串推 / 媒体上传（仅在 `x_get_post` / `node index.js post` 写参数下）
- **v3.1 拆专用工具**：上述写操作改走 `x_create_tweet` / `x_reply_tweet` / `x_quote_tweet` / `x_create_thread`，默认 `--dry-run`，必须 `--confirm`
- **永不做**：模拟点击任何 DOM CTA（INTERACTIVE 一律 `location.assign`）；OAuth 登录自动化；注入 cookie；伪造 ct0 / bearer；扫码 / captcha 自动化
- 不使用未在浏览器里实际发生过的 GraphQL 端点；改版前先用 `xhr-log` / `dom-dump` 踩点

## 路线图

- v2.0：4 个独立 scripts（`x-search.js` / `x-profile.js` / `x-post.js` / `x-home.js`），DOM 主路径 + 文件锁注册表协调 tab
- v3.0：架构升级到 `PAGE_PROFILES + Bridges + Session`；4 个 READ profile 走 GraphQL 主路径 + DOM 兜底；新增 `x_session_state` READ 工具 + 4 个 INTERACTIVE 导航工具；CLI 重构成 dispatcher（`lib/commands.js` 声明式映射）；`scripts/aggregate-profile.js` + `scripts/batch-search.js` + `scripts/_templates/` 调研三件套；`docs/dev/bridges-cheatsheet.md` 开发者速查表
- **v3.0.4（当前版本）**：openclaw 调研暴露的 4 个 bridge/session bug 修复 patch：
  - `lib/session.js`：新增 `_navigateAndVerify` —— `openUrl` 错误不再被吞，导航后用 `location.href` + `urlsEquivalent` 二次校验，不一致抛 `E_NAV_VERIFY_FAILED`；解决 "在 profile 页跑 search 拿到 profile 时间线" 的数据完整性 bug
  - `bridges/search-bridge.js`：恢复 GraphQL 主路径（`ENABLE_GRAPHQL = true`），在 `search() / searchViaDom()` 入口加 `location.pathname` 自检；`searchViaDom()` 还会用 `searchUrlMatches(keyword)` 校验当前 URL `q` 参数等于本次搜索关键词，不匹配返回 `not_on_search_page` + `reason: q_param_mismatch`（防止 `navigateOnReuse=false` 默认下读到旧关键词页面的 DOM）
  - `bridges/profile-bridge.js`：`UserTweetsAndReplies` 重发现拿到同样 queryId 时不再 retry；不可恢复时自动 fallback 到 `UserTweets`，meta 多 `repliesFallback / fallbackReason / secondaryRecovery / tweetsOpRequested` 字段
  - `bridges/post-bridge.js`：单次 `getPost` 加 wall-clock budget（默认 60s，`args.budgetMs` 可覆盖），`fetchXGraphQL` 单次 timeout 显式 25s；超出预算返回 partial + `meta.timedOut/partial/collectedReplyPages/durationMs`；`lib/bridgeAdapter.js::postViaBridge` callApi timeout 默认从 120s 降到 70s（10s buffer）让 wall-clock 优先触发
- **v3.1（下一步）**：拆 `bridges/compose-bridge.js` —— DESTRUCTIVE 唯一入口；4 个独立 DESTRUCTIVE 工具 `x_create_tweet` / `x_reply_tweet` / `x_quote_tweet` / `x_create_thread`；默认 `--dry-run`，必须显式 `--confirm` 才落地；砍 `x_get_post` 的写参数
- **未来**：`expand-replies` 工具（类似 reddit 的 `expand-more`）—— TweetDetail 评论树深度截断后的延展点

## Recording

`js-x-ops-skill` 全程接入 `@js-eyes/skill-recording`，每次工具调用都进同一套 history / cache / debug 流水。

- 默认记录模式跟随 `js-eyes` 全局配置中的 `recording.mode`
- 可通过 CLI 覆盖：
  - `--recording-mode off|history|standard|debug`
  - `--debug-recording`
  - `--no-cache`（仅 4 个 READ 工具进 cache；`x_session_state` 走 `lib/runTool.js`，不带 cache）
  - `--recording-base-dir /absolute/path`
  - `--run-id custom-id`

默认按技能分目录落盘到 `~/.js-eyes/skill-records/js-x-ops-skill/`：

- `history/`：按月滚动的 `tool_calls.jsonl`
- `cache/`：4 个 READ 工具的结构化抓取结果缓存
- `debug/`：调试模式下的步骤时间线、target / bridge meta 与结果快照

特殊处理约定：

- 保留现有 GraphQL 请求级缓存（bridge 内 module-scope `__jseXCache`，TTL 12h），不直接替换
- skill recording cache 只缓存最终结构化结果，避免与 queryId / timeline 请求缓存语义冲突
- debug bundle 重点记录 GraphQL 路径、DOM fallback、限流/重试和分页过程日志

## 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `E_NO_TAB` | 浏览器没打开任何 x.com / twitter.com tab | 在浏览器里打开 `https://x.com/` 任一页面；CLI 的 INTERACTIVE 命令默认会自动开新 tab，READ 命令默认 `createIfMissing=true` 也会兜底 |
| `connect WebSocket 401` | js-eyes server `allowAnonymous=false` 但 CLI 没拿到 token | `js-eyes server token show --reveal` 拿值，确认 `~/.js-eyes/runtime/server.token` 存在或 export `JS_EYES_TOKEN` |
| `RAW_EVAL_DISABLED` | 一侧 `allowRawEval=false` | 宿主 `~/.js-eyes/config/config.json` 的 `security.allowRawEval` + 扩展 popup 的 `Allow Raw Eval` 都要打开 |
| `loggedIn=false` 但浏览器明显已登录 | `/i/api/1.1/account/settings.json` 在隐私模式 / 第三方 cookie 限制下会 401 | `readLoginStateDom` 会兜底；如还不对就清 cookie 重新登录 |
| `bridgeFallback=true` + `bridgeFallbackReason='bridge_returned_error'` | bridge 拿到 X 响应但语义失败（404 / forbidden） | 看 `bridgeFallbackMessage` 取原始 X error；search 偶发 404 已自动降级 DOM |
| `bridgeFallbackReason='bridge_inject_failed'` | 注入失败，常因 X CSP 或扩展未连上 tab | 先跑 `node index.js doctor` |
| 推文字段缺失 | bridge GraphQL 主路径返回不完整 | `JS_X_DISABLE_BRIDGE=1 node index.js post <url>` 强制走 DOM 兜底；如果 DOM 路径有数据就是 bridge schema 退化，需要更新 `bridges/common.js::parseSingleTweetResult` |
| 429 频繁 | X 限流 | bridge 自动暂停 5 分钟（连续 3 次 429 后）；调小 `--max-pages`，或拉大 `--throttle-ms`（业务脚本） |
| `cross_origin_navigation_forbidden` | INTERACTIVE 调用传了非 X URL | 这是硬约束（`navigateLocation` 拒绝跨域）；只能传 `*.x.com` / `*.twitter.com` |
| `awaitBridgeAfterNav` 超时 | navigate 之后页面 reload 慢 / state 长时间不 ready | 增大 `--verbose` 看 stderr；或先 `node index.js state` 看当前 bridge state.ready 字段 |
| 改了 bridge 代码但浏览器里没生效 | `Session::ensureBridge` 只在 `bridge.__meta.version !== 文件 VERSION` 时重装 | 改完 bridge 必须 bump 顶部 `VERSION`，或手动关掉所有 X tab 让 bridge 丢失 |
| `E_NAV_VERIFY_FAILED` （v3.0.4+） | session 切 tab 后实际 URL 不等于期望 URL（X.com 把请求重定向 / 浏览器扩展拦截） | `err.detail` 里看 `actual / targetUrl`；通常是浏览器扩展或 X 自动重定向（如未登录），先手动跑 `node index.js navigate-search "<keyword>"` 再 `node index.js search "<keyword>"` |
| search 命令返回 `not_on_search_page` （v3.0.4+） | session 没成功导航到 `/search?q=...` | 看 `currentPath`；如果是 `/<user>` 说明 navigate 静默失败，看上面 `E_NAV_VERIFY_FAILED` 的处理 |
| `profile --include-replies` 拿到的是主时间线 + `meta.repliesFallback=true` （v3.0.4+） | `UserTweetsAndReplies` GraphQL queryId 失效，重发现拿到同样 queryId 后自动 fallback 到 `UserTweets`（不带 replies） | 不影响主时间线分析；如必须拿 replies，等 X 更新 bundle 后 queryId 会变；本地强制清缓存可在浏览器 console 跑 `__jse_x_profile__.__meta` 看 version |
| `getPost` 返回 `meta.timedOut=true` + `meta.partial=true` （v3.0.4+） | 单次 wall-clock budget（默认 60s）耗尽，老推文 / 大 thread 常见 | 已经返回当前已收集的 thread / replies 子集；如要拉满，传更大 budget：bridge 直调时 `args.budgetMs=120000` |

更多见 [`docs/dev/bridges-cheatsheet.md`](docs/dev/bridges-cheatsheet.md)。

## 目录结构

```text
skills/js-x-ops-skill/
├── SKILL.md                  # 技能描述（本文件）
├── package.json
├── index.js                  # 一行 require 委托给 cli/index.js
├── skill.contract.js         # 工具声明（5 READ + 4 INTERACTIVE）
├── cli/
│   └── index.js              # CLI dispatcher（按 lib/commands.js）
├── lib/
│   ├── api.js                # 编程 API（4 个 READ，bridge-first with fallback）
│   ├── session.js            # 主调度器
│   ├── config.js             # PAGE_PROFILES
│   ├── runTool.js            # READ 工具通用 dispatcher（history + debug bundle）
│   ├── commands.js           # 声明式命令表
│   ├── toolTargets.js        # targetUrl 拼接
│   ├── bridgeAdapter.js      # bridge 调用 + fallback 封装
│   ├── runCliToFile.js       # spawn stdout 直写 fd（绕开 64KB 截断）
│   ├── js-eyes-client.js     # WS 客户端
│   ├── runtimeConfig.js      # CLI / env / config.json 解析
│   └── xUtils.js             # 余留 helpers（已大幅瘦身）
├── bridges/
│   ├── common.js             # 浏览器侧 helpers（@@include 内联进每个 bridge）
│   ├── search-bridge.js
│   ├── profile-bridge.js
│   ├── post-bridge.js
│   └── home-bridge.js
├── scripts/
│   ├── x-search.js           # fallback only（已砍 main flow）
│   ├── x-profile.js          # fallback only（已砍 main flow）
│   ├── x-home.js             # fallback only（已砍 main flow）
│   ├── x-post.js             # 写操作仍走这里（v3.1 拆 compose-bridge）
│   ├── aggregate-profile.js  # 业务脚本：用户主页深度调研
│   ├── batch-search.js       # 业务脚本：批量 search
│   ├── _templates/           # 调研脚本模板（cp 即用）
│   │   ├── batch-search.js
│   │   ├── fetch-samples.js
│   │   └── README.md
│   └── _dev/                 # 开发者诊断脚本
│       ├── diff-search-schema.js
│       └── diff-post-schema.js
└── docs/
    └── dev/
        └── bridges-cheatsheet.md
```
