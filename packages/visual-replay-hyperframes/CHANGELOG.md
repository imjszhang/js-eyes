# @js-eyes/visual-replay-hyperframes — Changelog

记录 reddit/通用模板与 timeline 渲染层的语义变更。每条都尽量解释"为什么改"
而不是只列改了什么。

> 渲染端遵循 post-2.7.0 architecture pivot：composition 不再依赖 PNG / 帧序列 /
> 绝对像素坐标。模板只吃 `events.jsonl` 里的结构化 `payload`，任何"卡片渲不全"
> 的根因都要先回到上游 skill 的 `lib/visualHint.js::extractPayload`，模板侧只做
> "字段缺失也别难看"的兜底。

---

## [0.4.0] - 2026-05-03

### Added — DOM 事件渲染（cursor / typing / click ripple / spinner / scroll）

`js-reddit-ops-skill` v3.7.0 引入 `--mode dom|auto` 之后，events.jsonl 里多了
一类 `dom_*` 事件——记录 DOM 桥真实在前台做的操作（`dom_navigate` /
`dom_locate` / `dom_hover` / `dom_click` / `dom_type` / `dom_typed` /
`dom_scroll` / `dom_wait` / `dom_extract`）。0.4.0 让 timeline 把它们渲成
离线 composition 上肉眼可见的鼠标 / 打字机 / 波纹 / spinner / 平移：

- **`lib/timeline.js`** `buildTimeline` 加 `clips.dom = { navigate, wait,
  locate, hover, click, type, typed, scroll, extract }` 收集器。`dom_type`
  字符事件按"连续同 selector 段"聚合成 typing run（避免每字渲一帧 GSAP 设置
  压垮渲染），其余事件按时序原样累积
- **`lib/timelineScript.js`** 新增渲染分支：
  - `dom_locate / dom_hover / dom_click` → `.jse-cursor`（fixed div）通过
    GSAP `tl.to(...)` 平滑移到 rect 中心；click 时 `spawnRipple(rect)` 生
    `.jse-click-ripple` 600ms 波纹
  - `dom_type` typing run → 调 `setShellSearchValue(text, cursor)` 把 shell
    topbar 输入框 value 逐字 set（与 syncShellState 兼容）
  - `dom_wait` → `spawnSpinner(rect)` + 等 duration 后 `removeSpinner()`
  - `dom_scroll` → 主 `#stage` `gsap.to({ y: deltaY })` 短暂偏移再回弹
- **`lib/styleEmbed.js`** 加 `.jse-cursor` / `.jse-click-ripple` /
  `.jse-spinner` / `.jse-typing-caret` 样式 + `jse-ripple` / `jse-spin` /
  `jse-blink` keyframes
- **`lib/translator.js`** 把 `tl.clips.dom` 透到 `buildHtml` /
  `buildTimelineScript`

### Compatibility

老 session（0.3.0 / 0.2.0 录的 API-only events.jsonl）重渲：`clips.dom` 全空
→ 所有新增渲染分支 noop → 行为完全等同 0.3.0。**零回归**实测：
v0.3.0 录的 sess-ai-self-evolution-final 14 张卡用 v0.4.0 重渲，HUD / flash /
cards / shell 全部 1:1 一致。

### Verified

`runs/sess-ai-self-evolution-dom`（v3.7.0 + v0.4.0 录制 + 重渲 14 步深度
调研）：
- duration 583.7s / hud 50 / flash 99 / cards 25 / data items 79
- events.jsonl 含 `dom_navigate` 10、`dom_type` 75、`dom_typed` 6、
  `dom_locate` 16、`dom_wait` 11、`dom_extract` 7
- composition 离线播放：连续 cursor 轨迹 + 6 个 search 命令的逐字打字效果

---

## [0.3.0] - 2026-05-03

### Added — reddit page shell（页面外壳）

之前 0.2.0 的 composition 视觉是「一组风格化数据卡轮播」——卡片本身完整、信息
密度高，但缺少"在哪个网站、做什么动作"的叙事感。看到的是抽象的"reddit 调色数据
卡片秀"，而不是"在 reddit 上做调研"。这一版把架构从「N 张独立卡」升级成「常驻
chrome + 主区按 timeline 切换不同 reddit 页面」：

- **新增 `lib/shellLayout.js`**：`buildRedditShell({ communities })` 输出常驻
  topbar + leftnav 的 HTML 字符串。
  - topbar 含风格化 reddit logo（**inline SVG，不直接拷商标**：橙红 #d93900 圆 +
    白色加粗 "r"）+ 全宽 search input（`[data-shell-search]`，timelineScript 在
    search 卡 active 时填 query）+ Create 按钮 + 用户头像占位
  - leftnav 240px 左栏分两段：
    - **Feeds**：固定 Home / Popular / All（仅装饰）
    - **Communities**：从本会话 events.jsonl 扫出的 sub 列表（按首次出现顺序、
      去重，最多 12 条），timelineScript 当前 active card 对应的 sub 自动高亮
  - 整套 chrome 跨所有卡片常驻，不参与切卡动画
- **新增 `templates/reddit/pageHeader.js`**：`renderPageHeader(ctx)` 按
  `ctx.toolName` 分发渲染每张卡片专属的 page header：
  - `reddit_search`：搜索结果 banner（query 大字 + N results · scope 副标）+
    type filter pills（Posts/Comments/Communities/People，默认 Posts active）+
    sort pills（Relevance/Hot/Top/New/Comments，按 payload.sort 高亮）
  - `reddit_subreddit_about`：sub banner（彩色圆 + r/<sub> + Joined 按钮 +
    "About community" 徽章）+ meta-pill（subscribers / Public）
  - `reddit_list_subreddit`：sub banner + sort tabs（Hot/New/Top/Rising，按
    payload.sort 高亮）
  - `reddit_user_profile`：user banner + tab bar（overview/posts/comments/saved）
  - `reddit_session_state`：user dropdown 展开态（绿点 + Logged in as +
    u/<username> + karma）
  - `reddit_inbox_list` / `reddit_my_feed`：banner + tab bar
  - `reddit_navigate_*`：breadcrumb（from URL → to URL）
  - 其他工具或非 reddit skill：返回空字符串（不渲 page header，进 stage 主体）
- **改 `lib/translator.js`**：
  - `buildCards()` 扫一遍 timeline 收集 `communities`（去重的 sub 名按首次出现
    顺序）连带返回；并给每张卡 wrap 注入 page-header + 设 `data-page-type` /
    `data-page-meta`（JSON 字符串，含 `{ sub, sort, query, feed, box }`）
  - `buildHtml()` 在 `<main id="stage">` 外面包一层 `<div id="reddit-shell">`，
    前面 prepend topbar + leftnav。`<body data-shell="reddit">` 标记打开 chrome
    样式（reddit 之外的 skill 自动跳过 shell，body 上写 `data-shell="none"`）
- **改 `lib/timelineScript.js`**：每张卡入场同时刻调 `syncShellState(cardEl)`：
  读卡片 `data-page-type` + `data-page-meta`，更新 `[data-shell-search]` input
  value（search 卡填 query，其他卡留空 placeholder）+ leftnav 当前 sub 高亮 +
  leftnav 当前 feed 高亮。`window.__jseSyncShellState` 暴露给外层做调试 / 自动化
- **改 `lib/styleEmbed.js`**：新增约 60 条 CSS 规则（`body[data-shell="reddit"]`
  作用域，零回归非 reddit skill）：
  - `#reddit-shell` grid layout：56px topbar + 240px leftnav + 主区
  - `.reddit-topbar` sticky 顶栏样式（圆角 search input、focus 蓝边、悬浮态、
    用户头像）
  - `.reddit-leftnav` 浅灰边 + 分段 + 当前 active 项左侧橙色色条
  - `.reddit-page-header` 各档：search banner / sub banner / sub-list sort
    tabs / user banner / nav breadcrumb / user dropdown
  - `.sort-tabs .pill.active` 高亮态（橙色边 + 浅橙背景）
  - `.card-stage` 适应 shell 主区收紧到 `max-width: 880px`
  - 响应式：< 900px leftnav 自动隐藏；< 600px 头像名隐藏

### 老 session 兼容

- v0.2.0 写出来的 `events.jsonl` 不需要重录就能用 v0.3.0 重渲——shell / page-header
  完全是渲染层叠加，不改 events 结构，不改模板 ctx，不改 timeline track 字段
- 实测：把 sess-ai-self-evolution-final（v0.2.0 录的）用 v0.3.0 重渲：14 张卡
  full shell + page-header，77 个 flash 全部命中（tier=exact），missingTemplates=[]，
  durationSec / cardCount / hudCount / flashCount 与 v0.2.0 重渲一致

### Tradeoffs

- **风格化而非商标**：reddit 配色 / 圆形头像 / 圆角 search 是 reddit 风，但 logo
  是简化 SVG（不直接拷 reddit 商标 / 不抓 reddit 真实图片）；用 system font 而
  非 reddit Sans
- **shell 仅对 reddit-ops 启用**：`buildHtml` 用 `skillId.includes('reddit')`
  判断启用，其他 skill 走 `data-shell="none"` 老路径，避免给非 reddit 模板加
  无意义的 chrome
- **不依赖 DOM 实测**：保持 post-2.7.0 离线 composition 优势——无 PNG / 无字体
  外链 / 无图片 baking / 无网络回环；shell 全部内联

---

## [0.2.0] - 2026-05-03

### Added — 模板冷启动（PR 2）

之前的失败兜底是渲一段死字 `<div class="empty-hint">no template / no payload</div>`：
任何没注册过的 `(skillId, kind)` 都会落到这里，整张卡片就一行字。给 reddit-ops
之外的新 skill 接入造成阻塞——必须在写出第一条 events.jsonl 之前就先把模板写好，
否则录像看着就是空的。这次给 hyperframes 加两条轨：

- **运行时兜底（`templates/_generic/`）**：
  - 新增 `templates/_generic/genericKv.js`：智能 renderer，根据 payload 形态选档位
    - `payload.items[]` 非空 → 渲"通用列表"，复用 `.reddit-card-list` 样式（最多 8 条；
      自动从 item 里抽 `title / id / url / subreddit / author / score / preview` 这些
      常见字段；缺什么字段就不渲什么）
    - `payload.fields[]` 非空 / `payload.summary` 字符串 → 渲 KV info-card，复用
      `.reddit-info-card` 样式
    - 三者皆空 → 折叠 `<details>` 显示 raw payload JSON（最多 4KB），右上角橙色
      badge `generic · <skillId>/<kind>` 标识"这是兜底，不是专属模板"
  - 新增 `templates/_generic/index.js`：注册 `('*', '*')` 终极档位
- **registry 查找链 5 档化**：`templates/registry.js`
  - `getTemplate(sid, k)` 链：`(sid, k) → ('*', k) → (sid, '*') → ('*', '*') → ('*', 'global')`
  - 返回值新增 `matchTier` 字段（`exact / kind-wildcard / skill-wildcard / generic /
    legacy-global`），上层 translator 能精确判断"这卡是不是走兜底了"
  - 新增 `findUnknownKinds(pairs)`：给 scaffold CLI 用，过滤出走兜底的二元组
- **translator 诊断输出**：`lib/translator.js`
  - `buildCards` 返回 `{cards, templateUsage}`，每张卡都记 `{skillId, kind, tier}`
  - `replay-summary.json` 新增两个字段：`templateUsage` 全量 + `missingTemplates`
    聚合（按 count 倒序）；CI 可读这个字段决定是否提醒"补模板"
- **scaffold CLI**：`cli/jse-template-scaffold.js`
  - 用法：`jse-template-scaffold <session-dir> [--out <dir>] [--skill <id>] [--dry-run]`
  - 行为：
    1. 扫 events.jsonl 抽 `(skillId, kind)` 二元组 + 抽样 ≤8 条 payload
    2. 调 `findUnknownKinds` 过滤出未专属注册的
    3. 浅扫推断 payload shape（顶层 keys / `items[0]` keys / `fields[].k` 集合 +
       每个键观察到的 type 集合）
    4. 按 shape 选骨架风格（list / kv / raw），写出 `<out>/<skill>/<kind>.js` +
       `<out>/<skill>/index.js`（自动 `register` 调用）
    5. 骨架文件含 TODO 注释列出所有推断字段，作者 `mv` 到 `templates/<skill>` 后
       照着补 reddit 风格的 HTML
  - dry-run 模式只打印计划，不写盘
- **README**：新增"为新 skill 制作模板（v0.2.0 模板冷启动）"章节，详记三条轨道的
  组合用法。模板 API 文档同步：`kind` 类型从枚举放宽到 `string`，`getTemplate` 增
  `matchTier` 返回值，新增 `findUnknownKinds` 签名。

### Changed

- `package.json` 版本 `0.1.1` → `0.2.0`（minor：新增 `('*','*')` 兜底档位 + scaffold
  CLI；既有 `register` API、`replay-summary.json` 既有字段都向前兼容）
- `package.json` `bin` 加 `jse-template-scaffold`
- `lib/translator.js` 顶部 require 顺序：先 `_generic` 再 `reddit`，让任何卡片都至少
  有兜底（虽然 registry 查找链按优先级，无关 require 先后，但顺序写明意图）

### Notes

- 老 session 重渲行为完全不变（reddit 已注册全部 kind，仍走 `exact` / `kind-wildcard`
  档；`templateUsage` 显示 `tier=exact`）
- 新增 `('*', '*')` 不影响现有 reddit 已注册的 `('*', list/item/...)`：后者更专 kind
  优先级更高
- scaffold CLI 写的是骨架，**不替作者判断"哪些字段是主数据"**（比如 sub-about 的
  hero metric 需要人工挑），骨架先保证能跑、能渲，后续打磨样式
- 在 reddit `runs/sess-ai-self-evolution` 上验过：scaffold dry-run 输出 "all kinds
  registered. Nothing to scaffold."，重渲 `templateUsage` 全部走 `exact`，零回归
- 在手工 fixture（`kind=stats / table` 未注册）上验过：未注册 kind 渲出 generic
  KV / list 卡 + 橙色 badge，不再出现 `no template / no payload`；scaffold 产出 3
  个文件（`stats.js / table.js / index.js`），mv 进去后 require + 调 `getTemplate`
  返回 `tier=exact`，渲染语法正确

## [0.1.1] - 2026-05-03

### Fixed

- `templates/reddit/list.js` 的 sub-title 在 `payload.sub` 为空时（典型场景：reddit
  全站 search、`pickListing` 没识别出 sub 的列表）会硬编码成 `'reddit'`，导致同一
  composition 里几张全站 search 卡片标题完全一样，无法区分。
  - 修复：sub-title 兜底链改为 `r/<sub>` → `payload.label` → `ctx.label` →
    `ctx.hint.label` → `'reddit'`，这样 reddit-ops bridge 给出的 `label`（例如
    "搜索 ai self evolution"）会正常显示在标题位。
- `templates/reddit/item.js::renderInfoCard` 渲 sub-about / session-state 这种
  "几个原子字段 + 一个标志性大数字"的信息卡时，所有字段都用同等大小的 `dt/dd`
  网格排列，订阅数 / activeUserCount 这种关键指标看不出来主次。
  - 修复：`renderInfoCard` 抽出 hero metric（匹配 `subscribers / subscriberCount /
    activeUserCount / totalKarma / num_comments / comment_count`），单独大字号渲
    在卡片顶部；其余字段照常进 kv-grid。
  - `lib/styleEmbed.js` 加配套 `.hero-metric / .hero-num / .hero-label` 样式
    （大字号、accent 色、底部分隔线）。

### Changed

- `package.json` 版本 `0.1.0` → `0.1.1`（patch：模板兜底 + 视觉增强，不破坏既
  有 composition 协议）。
- 老 session 包重渲即可看到 list 标题修复；info-card 的 hero metric 需要上游
  skill ≥ `js-reddit-ops-skill 3.6.2`（fields 里要先有 `subscribers` 这种字段
  名才能匹配到）。

### Notes

- 不修 `events.jsonl` schema，不动 `index.js` / `lib/translator.js`；仅模板与
  样式两层。
- 已在 `runs/sess-ai-self-evolution` 上重渲验证：list 标题不再死字 `reddit`；
  老 session 的 sub-about 卡因为 `payload.fields` 还是旧的 `[{k:'sub'}]`，不会
  自动恢复，需要在 skill 升级到 3.6.2 后重录一次。

---

## [0.1.0] - 2026-04 ~ 2026-05 早期

- post-2.7.0 architecture pivot 落地：从 PNG 帧序列改为 events.jsonl 结构化
  payload + HTML 模板渲染；引入 reddit / generic 模板族；HUD / progress / flash
  outline 按 vw / clamp 适配响应式；spawn `npx hyperframes` 输出 MP4。
- 详情见 `journal/2026-05-03/visual-replay-pivot-followup.md`。
