## Bridges Cheatsheet（X 版）

> 给开发者看的速查表。AI 不需要读这份；AI 看 `SKILL.md` 即可。

每个 bridge 都是装在 `window.__jse_x_<name>__` 上的对象，方法返回 `{ ok, data }` 或 `{ ok:false, error, ... }`。

修改任意方法后请 bump 该 bridge 顶部的 `VERSION` 常量；下一次 `session.ensureBridge()` 自动重装（参考 `lib/session.js::ensureBridge`）。

`@@include ./common.js` 是注入期内联指令（`lib/session.js::expandBridgeSource`），用来把 `bridges/common.js` 的工具函数原样塞进每个 bridge 的 IIFE，避免运行期跨文件依赖。

---

### bridges/common.js（不直接 install，只是被 @@include）

| 工具                              | 用途                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `clampLimit(n, def, max)`         | 列表 limit 截断                                                     |
| `shortText(s, max)`               | 长文本截断 + truncated 标记                                         |
| `okResult / errResult`            | 统一返回壳                                                          |
| `getCt0Cookie() / getAuthToken()` | 提取 `ct0` 和 `Bearer` 用于 GraphQL 请求                            |
| `isOnX()`                         | 同源校验（`*.x.com` / `*.twitter.com`）                              |
| `_scanPerformanceForOp(op)`       | 通过 `performance.getEntriesByType('resource')` 抓 GraphQL queryId / features / variables |
| `getCachedGraphQLParams(op)` / `setCachedGraphQLParams` / `invalidateGraphQLCache(op)` | 模块作用域 GraphQL 参数缓存（TTL 12h），429 / 4xx 时手动 invalidate |
| `fetchXGraphQL(opName, vars, features)` | 自动 bearer + ct0 + same-origin cookie + 429 backoff，返回 `{ ok, data, statusCode, queryId, source }` |
| `parseTweetArticle(article)`      | DOM 文章节点 → 标准 tweet 行（fallback 用）                         |
| `collectTweetsFromDom(rootDoc)`   | DOM 列表 → tweets[]（fallback 用）                                   |
| `parseSingleTweetResult(tr)`      | GraphQL TweetResult/itemContent → 标准 tweet 行（**字段对齐**：author/stats/mediaDetails/quoted/cardUrls/visibility/...） |
| `extractTweetFromGraphQLNode(n)`  | `parseSingleTweetResult` 的别名                                     |
| `parseTweetEntries(entries)`      | timeline_v2 `instructions[].entries` → tweets[]                     |
| `pickMediaFromTweet(tweet)`       | tweet.mediaDetails → 去重 image/video URL 列表                       |
| `readLoginStateDom()`             | 旧版/新版 X DOM 兜底登录态                                          |
| `sessionStateCommon()`            | 给所有 bridge 复用的登录态查询（基于 cookie + `/i/api/1.1/account/settings.json`） |
| `navigateLocation(url)`           | 仅 same-origin x.com/twitter.com，仅 `location.assign`，跨站返回 `cross_origin_navigation_forbidden` |
| `buildXSearchUrl(opts)`           | search URL 拼接 + sort→product 转换                                 |

> **设计取舍**：READ 数据优先走 X.com 内部 GraphQL（同源，复用 cookie + bearer）；queryId / features / variables 通过 performance API 动态发现并缓存；DOM fallback 仅在 GraphQL 失败时启用。

---

### bridges/search-bridge.js（v3.0.2，page=`search`，global=`__jse_x_search__`）

| 方法                  | GraphQL Op / 端点          | 说明                                                                                              |
| --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `probe()`             | -                           | 页面指纹（url / pathname / `parseSearchParams` / DOM 命中）                                       |
| `state()`             | -                           | 当前搜索的 `{ q, sort, ready, ... }`                                                              |
| `sessionState()`      | `/i/api/1.1/account/settings.json` | 登录态（`x_session_state` 工具背后）                                                            |
| `search(args)`        | `SearchTimeline`            | keyword/sort/maxPages/since/until/lang/from/minLikes/...，**SearchTimeline 偶发 404 → 自动降级到 DOM 提取** |
| `navigateSearch(args)`| -                           | INTERACTIVE：`location.assign` 到 `https://x.com/search?q=&f=`                                    |

注：search 主路径优先 DOM 抽取（`_extractTweetsFromDom`）+ 翻页用 `__NEXT_DATA__` cursor；GraphQL 路径作为补充。429 连续 3 次会暂停 5 分钟。

---

### bridges/profile-bridge.js（v3.0.2，page=`profile`，global=`__jse_x_profile__`）

| 方法                  | GraphQL Op                   | 说明                                                                                            |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `probe / state / sessionState` | -                  | 同上                                                                                            |
| `getProfile(args)`    | `UserByScreenName` + `UserTweets` / `UserTweetsAndReplies` | 二段：先解析 userId，再翻页 timeline。`includeReplies` 切第二个 op；返回里 `profile` 字段带 followers/following/createdAt/verified |
| `navigateProfile(args)` | -                          | INTERACTIVE：`https://x.com/<username>` 或 `<username>/with_replies`                            |

---

### bridges/post-bridge.js（v3.0.2，page=`post`，global=`__jse_x_post__`）

| 方法                  | GraphQL Op                   | 说明                                                                                            |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `probe / state / sessionState` | -                  | 同上                                                                                            |
| `getPost(args)`       | `TweetDetail` → `TweetResultByRestId` 兜底 | 单帖正文 + 串推 + 回复树。`withThread`/`withReplies` 控制深度；`parseSingleTweetResult` 完整覆盖 author/stats/mediaDetails/quoted/cardUrls/visibility/isVerified/quotes |
| `navigatePost(args)`  | -                            | INTERACTIVE：`https://x.com/i/status/<id>`（不需要 username）                                   |

注：v3.0.2 起 `parseSingleTweetResult` 与老 `scripts/x-post.js` 字段一致（`scripts/_dev/diff-post-schema.js` 守护）。

---

### bridges/home-bridge.js（v3.0.2，page=`home`，global=`__jse_x_home__`）

| 方法                  | GraphQL Op                   | 说明                                                                                            |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `probe / state / sessionState` | -                  | 同上                                                                                            |
| `getHome(args)`       | `HomeTimeline` 或 `HomeLatestTimeline` | feed=foryou/following 切 op；maxPages 翻页；未登录会被 X 重定向到 explore                     |
| `navigateHome(args)`  | -                            | INTERACTIVE：`https://x.com/home`，feed=following 时切到 `/home/following`                      |

---

## 实用工具（lib/）

| 模块                     | 出口                       | 用途                                                                                                 |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `lib/runCliToFile.js`    | `{ runCliToFile }`         | 跑 `node index.js <args...>` 把 stdout 直写到目标文件，绕开 spawn().stdout 的 64KB 截断。批量调研脚本必备 |
| `lib/session.js`         | `{ Session }`              | 主调度器，外部脚本可以 `new Session({ opts:{ page, reuseAnyXTab:true } })` 后 `connect/resolveTarget/ensureBridge/callRaw/callApi` |
| `lib/runTool.js`         | `{ runTool }`              | READ 工具通用 dispatcher：Session + bridge + recording + debug bundle 一站式                          |
| `lib/bridgeAdapter.js`   | `{ scrapeViaBridge, ... }` | 调用新 bridge 方法 + 失败 fallback 回老 `scripts/x-*.js` 实现的统一封装                              |
| `lib/js-eyes-client.js`  | `{ BrowserAutomation }`    | WS 客户端。`Session` 内部用，外部一般不直接 new                                                       |
| `lib/commands.js`        | `{ COMMANDS }`             | 声明式命令表（kind/api/argSpec/targetUrl）                                                            |
| `lib/toolTargets.js`     | `{ buildSearchUrl, ... }`  | 各命令 `targetUrl` 拼接                                                                              |

`runCliToFile` 速用：

```js
const path = require('path');
const { runCliToFile } = require('/path/to/skills/js-x-ops-skill/lib/runCliToFile');

const SKILL_DIR = '/path/to/skills/js-x-ops-skill';

const r = await runCliToFile({
  skillDir: SKILL_DIR,
  args: ['search', 'AI agent', '--sort', 'top', '--max-pages', '3'],
  outFile: path.join(__dirname, 'raw/ai-agent.json'),
});
console.log(r.code, r.elapsedMs, r.outBytes);
```

---

## 环境开关

| 变量                       | 作用                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `JS_X_DISABLE_BRIDGE=1`    | 强制走老路径（`scripts/x-*.js`）。用于 diff 校验和 bridge bug 兜底                            |
| `JS_X_DISABLE_FALLBACK=1`  | 关闭兜底；bridge 失败直接 throw。CI / 调试用                                                  |
| `JS_EYES_WS_URL=ws://...`  | js-eyes server endpoint。优先级低于 `--browser-server`                                        |
| `JS_EYES_TOKEN=...`        | 显式 server token。优先级低于 `~/.js-eyes/runtime/server.token`                                |

---

## 故障排查

| 现象                                                                | 通常原因                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `connect WebSocket 401 / Unexpected server response: 401`           | js-eyes server 默认 `allowAnonymous=false`。CLI 没拿到 token：先 `js-eyes server token show --reveal`，再确认 `~/.js-eyes/runtime/server.token` 存在或 export `JS_EYES_TOKEN`。`lib/js-eyes-client.js::_resolveToken` 优先级 options.token > env > runtime/server.token |
| `bridgeFallback=true` + `bridgeFallbackReason='bridge_returned_error'` | bridge 拿到 X 响应但语义失败（如 404 / GraphQL forbidden）。看 `bridgeFallbackMessage` 取原始 X error |
| `bridgeFallbackReason='bridge_inject_failed'`                       | 注入失败，常因 X CSP 或扩展未连上 tab。先跑 `node index.js doctor` |
| `bridgeFallbackReason='bridge_no_target_tab'`                       | 没有任何 X tab 且 `createIfMissing=false`。READ 工具默认 true        |
| `SearchTimeline 404`                                                | X 偶尔下线 search GraphQL；search-bridge 已自动降级到 DOM 抽取，无需干预 |
| GraphQL queryId 失效 / 400                                          | bridge 自动 `invalidateGraphQLCache` 并重新 discover。**首次失败可能丢一页**，重跑即可 |
| `loggedIn=false` 但浏览器明显已登录                                 | `/i/api/1.1/account/settings.json` 在隐私模式 / 第三方 cookie 限制下会 401。`readLoginStateDom` 会兜底 |
| 改了 bridge 代码但浏览器里没生效                                    | `Session::ensureBridge` 只在 `bridge.__meta.version !== 文件 VERSION` 时重装。改完 bridge 必须 bump 顶部 `VERSION`，或手动关掉所有 X tab 让 bridge 丢失 |
| `Session::callRaw` 里 `fetch('/i/api/...')` 抛 `... is not a valid URL` | `executeScript` 走的是扩展隔离上下文，没有 `document` 也没有 base origin，相对路径 fetch 会失败。**必须传绝对 URL**：`fetch('https://x.com/i/api/...', { credentials:'include' })`。bridges/ 下用 `fetchXGraphQL` 已自动加前缀 |
| 429 连续 3 次 → 暂停 5 分钟                                         | bridge 内置保护，触发后整个 Session 静默 5 分钟；建议把 `--max-pages` 调小或拉长 `--throttle-ms` |
| `parseSingleTweetResult` 字段缺失                                   | 通常是 X 改了 GraphQL schema。`scripts/_dev/diff-post-schema.js` / `diff-search-schema.js` 守护字段一致性；diff 不通过先看 schema 改动 |
| 批量跑 `node index.js search/profile/...` 把 stdout 写文件，结果偶发性截断在 65536 字节 | Node `child_process.spawn().stdout.pipe(fs.createWriteStream)` 在大输出（>64KB）下会丢尾。改用 `lib/runCliToFile.js`：内部走 `stdio: ['ignore', fd, 'pipe']` 让子进程 stdout 直写 fd，绕开 readable 缓冲。所有 `scripts/` 和 `work_dir/x/*/run-searches.js` 风格的批处理都应当用它 |

---

## 烟测顺序（联机）

```bash
node index.js doctor --pretty                                # 4 profile 一站诊断
node index.js session-state --pretty                         # 登录态
node index.js search "AI agent" --sort latest --max-pages 1 --pretty
node index.js profile elonmusk --max-pages 1 --pretty
node index.js post https://x.com/<user>/status/<id> --pretty
node index.js home --feed foryou --max-pages 1 --pretty

# bridge ↔ DOM schema 一致性
node scripts/_dev/diff-search-schema.js "AI"
node scripts/_dev/diff-post-schema.js https://x.com/<user>/status/<id>

# INTERACTIVE（注意：会切走当前 X tab）
node index.js navigate-search "AI"
node index.js navigate-profile elonmusk
node index.js navigate-post https://x.com/<user>/status/<id>
node index.js navigate-home --feed following

# 写操作回归（保持 v2 行为，未在 v3.0 重构）
node index.js post --post "test" --dry-run
node index.js post https://x.com/<user>/status/<id> --reply "test" --dry-run
```

---

## 路线图

- **v3.0**（本次）：READ 侧（search/profile/post-readonly/home）+ 4 INTERACTIVE 导航 + 1 个 `x_session_state` READ 工具。架构落地：`PAGE_PROFILES + Session + Bridges + bridge-first with fallback`。写操作（reply/post/quote/thread）保持 v2.0.1 行为。
- **v3.1**（下一步）：拆 `bridges/compose-bridge.js`（DESTRUCTIVE 唯一入口）；4 个独立 DESTRUCTIVE 工具（`x_create_tweet` / `x_reply_tweet` / `x_quote_tweet` / `x_create_thread`）；`--confirm` + 默认 `--dry-run` 安全约束；砍 `x_get_post` 的写参数。
