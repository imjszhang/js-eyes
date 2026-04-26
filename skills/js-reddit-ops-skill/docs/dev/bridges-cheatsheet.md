## Bridges Cheatsheet

> 给开发者看的速查表。AI 不需要读这份；AI 看 `SKILL.md` 即可。

每个 bridge 都是装在 `window.__jse_reddit_<name>__` 上的对象，方法返回 `{ ok, data }` 或 `{ ok:false, error, ... }`。

修改任意方法后请 bump 该 bridge 顶部的 `VERSION` 常量；下一次 `session.ensureBridge()` 自动重装（参考 `lib/session.js::ensureBridge`）。

`@@include ./common.js` 是注入期内联指令（`lib/session.js::expandBridgeSource`），用来把 `bridges/common.js` 的工具函数原样塞进每个 bridge 的 IIFE，避免运行期跨文件依赖。

---

### bridges/common.js（不直接 install，只是被 @@include）

| 工具                        | 用途                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| `clampLimit(n, def, max)`   | 列表/评论 limit 截断                                              |
| `shortText(s, max)`         | 长文本截断 + truncated 标记                                       |
| `unixToIso(unix)`           | reddit 的 `created_utc` → ISO8601                                 |
| `detectFrontend()`          | shreddit / oldReddit / unknown 探测                               |
| `buildRedditUrl(path, qs)`  | 拼 `https://www.reddit.com<path>?...&raw_json=1`                  |
| `fetchRedditJson(path, qs)` | `credentials:'include'` GET，自动加 `.json`，含 contentType 兜底  |
| `readMeViaApi()`            | `/api/v1/me.json` → `{ loggedIn, userName, ... }`                 |
| `readLoginStateDom()`       | 旧版/新版 reddit DOM 兜底登录态                                   |
| `parsePostUrl(url)`         | 解出 `{ sub, postId }`                                            |
| `pickImageUrlsFromPost(p)`  | preview / gallery / media → 去重 image url 列表                   |
| `buildCommentTree(items)`   | reddit listing children → 嵌套评论树。`_kind:'more'` marker 自带 `_children` / `_count` / `_parent_id` / `depth` 四个字段，能直接喂给 `expandMore` |
| `normalizePostListingItem`  | t3 → 标准 post 行                                                 |
| `normalizeCommentListingItem` | t1 → 标准 comment 行                                            |
| `summarizeListing(...)`     | listing → `{ items, after, before, total, returned }`             |
| `sessionStateCommon()`      | 给所有 bridge 复用的登录态查询                                    |
| `okResult / errResult`      | 统一返回壳                                                        |
| `navigateLocation(url)`     | 仅 same-origin reddit.com，仅 `location.assign`                   |

---

### bridges/post-bridge.js（v3.4.1，page=`post`，global=`__jse_reddit_post__`）

| 方法           | fetch 端点                                                                                          | 说明                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `probe()`      | -                                                                                                   | 页面指纹（url / pathname / DOM 命中 / frontend）                                                                |
| `state()`      | -                                                                                                   | 当前帖子的 `{ sub, postId, ready, ... }`                                                                        |
| `sessionState()` | `/api/v1/me.json`                                                                                 | 登录态（`reddit_session_state` 工具背后）                                                                       |
| `getPost(args)`  | `/r/<sub>/comments/<id>.json?raw_json=1&depth&limit&sort`                                          | 帖子正文 + 评论树。返回与旧 DOM 版一致；`comments` 树里 `_kind:'more'` 节点标识被折叠的子节点（用 expandMore 展开） |
| `expandMore(args)` | `/api/morechildren?api_type=json&link_id=t3_xx&children=a,b,c&sort&depth`                       | 把 `more` marker 里的 `_children` 列表换成扁平 `items[]` + `byParent` 索引；> 500 个 child 会被截断              |
| `navigatePost(args)` | -                                                                                              | INTERACTIVE：`location.assign` 到 `https://www.reddit.com/r/<sub>/comments/<id>/`                              |

`expandMore` 输入：

```text
linkId        必填，t3_xxxxx
children      必填，array<string> 或逗号分隔字符串（来自 _kind='more' 节点的 _children）
sort          可选，top|best|new|old|controversial|qa|confidence（默认 top）
depth         可选，1..20
limitChildren 可选，单次提交 child id 上限（默认 200，最大 500）
```

`expandMore` 输出关键字段：`items`（扁平 t1 节点，带 `parent_id`/`depth`）、`moreItems`（嵌套的二级 `more` marker）、`byParent`（按 parent_id 索引，方便重新拼回原树）。

---

### bridges/listing-bridge.js（v3.4.1，page=`subreddit`，global=`__jse_reddit_listing__`）

| 方法                 | fetch 端点                                                          | 说明                                                          |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `probe / state / sessionState` | -                                                          | 同上                                                          |
| `listSubreddit(args)` | `/r/<sub>/<sort>.json?t=<t>&limit=<n>&after=<cursor>`              | sort ∈ hot/new/top/rising/controversial/best；返回标准 post 列表 |
| `subredditAbout(args)` | `/r/<sub>/about.json`                                              | 订阅数 / 描述 / NSFW / 创建时间                                |
| `navigateSubreddit(args)` | -                                                              | INTERACTIVE：`/r/<sub>/<sort>/?t=<t>`，或 `--about` 时去 about 页 |

---

### bridges/search-bridge.js（v3.4.1，page=`search`，global=`__jse_reddit_search__`）

| 方法               | fetch 端点                                                                              | 说明                                                              |
| ------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `search(args)`     | `/search.json?q=&sort=&t=&type=&limit=&after=` 或 `/r/<sub>/search.json` + `restrict_sr=on` | type=link 走标准 t3 listing，type=sr/user 切换 listing schema       |
| `navigateSearch(args)` | -                                                                                   | INTERACTIVE，可 `--clear` 把 URL 清回 `/search/`                    |

---

### bridges/user-bridge.js（v3.4.1，page=`user`，global=`__jse_reddit_user__`）

| 方法                 | fetch 端点                                                              | 说明                                                                  |
| -------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `userProfile(args)`  | `/user/<name>/<tab>.json?sort=&t=&limit=&after=` 与 `/user/<name>/about.json` 并发 | tab ∈ overview/submitted/comments/saved/upvoted/downvoted/gilded/hidden；非自己访问 saved/upvoted/... 会 403。返回里 `about` 字段直接带 totalKarma / linkKarma / commentKarma / createdUtc / isMod / isGold（v3.4.1+ 起） |
| `navigateUser(args)` | -                                                                       | INTERACTIVE                                                           |

---

### bridges/inbox-bridge.js（v3.4.1，page=`inbox`，global=`__jse_reddit_inbox__`）

| 方法                | fetch 端点                                              | 说明                                                              |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `inboxList(args)`   | `/message/<box>.json?limit=&after=`                     | box ∈ inbox/unread/messages/mentions/sent；**未登录直接 403**     |
| `navigateInbox(args)` | -                                                     | INTERACTIVE                                                       |

---

### bridges/home-bridge.js（v3.4.1，page=`home`，global=`__jse_reddit_home__`）

| 方法              | fetch 端点                                                                                | 说明                                                              |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `myFeed(args)`    | feed=home → `/.json` 或 `/<sort>.json`；feed=popular/all → `/r/popular/<sort>.json` 等   | 返回标准 post 列表；home 不登录会被 reddit 重定向到 popular        |
| `navigateHome(args)` | -                                                                                      | INTERACTIVE                                                       |

---

## 故障排查

| 现象                                                                | 通常原因                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `connect WebSocket 401 / Unexpected server response: 401`             | js-eyes server 默认 `allowAnonymous=false`。CLI 没拿到 token：先 `js-eyes server token show --reveal` 拿值，再确认 `~/.js-eyes/runtime/server.token` 存在或 export `JS_EYES_TOKEN`。`lib/js-eyes-client.js::_resolveToken` 优先级 options.token > env > runtime/server.token > secrets/server-token |
| `bridgeFallback=true` + `bridgeFallbackReason='bridge_returned_error'` | bridge 拿到 reddit 响应但语义上失败（如 403 / 路由不命中）。看 `bridgeFallbackMessage` 取原始 reddit error |
| `bridgeFallbackReason='bridge_inject_failed'`                       | 注入失败，常因网页 CSP 或扩展未连上 tab。先跑 `node index.js doctor` |
| `bridgeFallbackReason='bridge_no_target_tab'`                       | 没有任何 reddit tab 且 `createIfMissing=false`。READ 工具默认 true     |
| `expandMore` 返回 `errors:[...]`                                    | reddit 拒绝了部分 child（删除 / 私密 / 不属于 link_id）。其他 child 仍会被返回 |
| `inboxList` 报 403                                                  | 未登录。先 `reddit_session_state` 确认 `loggedIn`                  |
| `loggedIn=false` 但浏览器明显已登录                                 | `/api/v1/me.json` 在隐私模式 / 第三方 cookie 限制下会 401。`readLoginStateDom` 会兜底 |
| `diff-post-schema.js` 报 `image_urls` bridge 比 DOM 少               | 通常不是 bridge 的 bug：DOM 端会把 avatar / subreddit banner 当图扫进来，bridge 严格看 `media_metadata` / `preview.images` / `i.redd.it` / `preview.redd.it` 白名单。bridge 的输出对下游更准 |
| 改了 bridge 代码但浏览器里没生效                                    | `Session::ensureBridge` 只在 `bridge.__meta.version !== 文件 VERSION` 时重装。改完 bridge 必须 bump 顶部 `VERSION` 常量，或手动关掉所有 reddit tab 让 bridge 丢失 |

## 烟测顺序（联机）

```bash
node index.js doctor --pretty                                # 6 profile 一站诊断
node index.js session-state --pretty                         # 登录态
node index.js list-subreddit programming --limit 5 --pretty
node index.js subreddit-about programming --pretty
node index.js search "node.js" --limit 5 --pretty
node index.js user-profile spez --user-tab overview --limit 5 --pretty
node index.js my-feed --feed popular --limit 5 --pretty

# 拿一个有 more marker 的帖子，再 expand-more
node index.js post https://www.reddit.com/r/<sub>/comments/<id>/<slug>/ --pretty | jq '.result.comments | .. | objects | select(._kind=="more")'
node index.js expand-more t3_<id> "<csv_of_children>" --sort top --pretty

# bridge ↔ DOM schema 一致性
node scripts/_dev/diff-post-schema.js https://www.reddit.com/r/<sub>/comments/<id>/<slug>/

# INTERACTIVE（注意：会切走当前 reddit tab）
node index.js navigate-subreddit programming --sort top --time-range week
```
