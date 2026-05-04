# Changelog

All notable changes to `js-reddit-ops-skill` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this skill adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.8.1] - 2026-05-04

### Notes — visual-replay-hyperframes v0.6.0 联动（仅文档同步，代码不动）

`@js-eyes/visual-replay-hyperframes` v0.6.0 收敛成"snapshot 优先 + 最小模板兜底"，
砍掉 reddit chrome 仿真 / page-header / dom_* 合成动画 / scaffold CLI 等
snapshot 主链路下走不到的代码（约 1180 行）。skill 侧的运行时行为完全不变：

- `dom_*` 事件流仍照常 emit 进 events.jsonl（给上游审计 / 调试用）
- snapshot 模式下 `dom_*` 操作的视觉表现由真实截图序列承载（鼠标 / 输入 / 滚动 /
  点击都已被浏览器真实绘制并截进 JPEG），v0.5.x 那种合成端 cursor/typing/ripple
  等已下线
- bridge 录制时画在浏览器里的 HUD/flash 浮层照常生效，依旧被截进 JPEG（合成端
  默认不再额外叠 composition-side HUD/flash，避免双重画）

**Breaking（仅 jse-replay CLI 层）**：

- `--shell` / `--no-shell` 不再识别（"未知参数"）
- `--effects=cursor|typing|click|ripple|spinner|scroll|shell` 报
  `unknown effect: <name>` 退出 1
- 想要 v0.5.x 完整体验 → pin `@js-eyes/visual-replay-hyperframes@0.5.2`

**仅修文档**：

- `SKILL.md`：DOM-first 段落改写为"dom_* 事件给上游审计 / 真实视觉表现来自截图"；
  snapshot mode 表删 `--shell`、`--effects=all/cursor,typing` 行；新增 v0.6.0 breaking 提示
- `CHANGELOG.md`：本条目

## [3.8.0] - 2026-05-04

### Added — visual-replay snapshot mode（默认录制不叠特效）

`js-reddit-ops-skill` 在 dom-first 之上恢复 PNG/JPEG 截图链路作为录像主背景：
每个 dom_* 命令 wrapCallApi 边界默认截 1 帧 JPEG q=82（CSS 像素），
hyperframes v0.5.0 据此把 #stage 背景换成真实 reddit 截图序列；HUD + flash
仍叠在上层；cursor / typing / ripple / spinner / scroll 等 v0.4.0 合成
特效全部退到 `--effects=...` opt-in。

- **`lib/runTool.js` 接通 `makeFrameWriter`**：
  - `options.visualRecord` 启用时构建 `captureFrame` writer（throttle 80 帧 /
    200ms 间隔，JPEG q=82 默认 / q=92 hi-dpi）
  - `wrapCallApi` 调用处挂 `hooks.captureFrame` + `frameFormat: 'jpg'`，
    每条命令完成后自动截一帧
  - `dom_navigation_required` retry 分支前后各手动触发一次 `shootFrame('pre-nav')`
    / `shootFrame('post-nav')`，捕获跳页前的最终状态与落地页
  - `onWritten` 回调把 `{type:'frame', ts, frameRef, when, viewport}` 事件
    emit 进 bridge ring buffer，drainVisualEvents 自然取回写到 events.jsonl
  - ensureBridge 后探一次 `__jse_visual.viewport()` 写入 meta.json 的 `viewport`
    + `frames` 字段（quality / hiDpi / maxFrames）
- **CLI flag**（`lib/commands.js` parseArgv）：
  - `--no-frames` / `--frames` opt-out / opt-in 主链路截图
  - `--hi-dpi` / `--no-hi-dpi` 切换设备像素 vs CSS 像素
  - `--max-frames N` 覆盖 80 默认上限（16 步典型 ≈ 50 帧 < 50 MB）
- **`@js-eyes/visual-bridge-kit` v0.5.0** 联动：
  - `makeFrameWriter` 升回顶层 export（`/dev` 子路径仍兼容）
  - `wrapCallApi` await `hooks.captureFrame`，`onWritten` 同步回写 ring buffer
  - bridge VERSION 0.3.0 → 0.4.0，添加 `__jse_visual.viewport()` API

### Verified — 16 步深度调研重录（runs/sess-ai-self-evolution-snapshot）

- 14/16 步 dom 模式直通，2 步（search 限定 sub × 1 + user-profile × 1）落 api fallback
- events.jsonl 含 51 条 `frame` 事件，frames/ 51 张 .jpg（约 7.3 MB / 总尺寸 7.4 MB）
- composition.html 默认渲 PNG 序列 + HUD + flash，**无** cursor/typing/ripple
- `--all-effects --shell=always` 重渲 152 处 effects 调用 → 视觉等价 v0.4.0
- 老 session（v0.3.0/v0.4.0 fixture）零回归（events 无 frame 自动退模板）

### Migration

- 默认行为变化：`--visual-record <dir>` 现在自动启用截图。如需关闭传 `--no-frames`
  （CI / 性能敏感场景） — events.jsonl 与 meta.json 仍正常写，只是不写 `frame` 事件
  + 不落 frames/，hyperframes 自动退模板模式
- 性能影响：每条命令额外 ~200-500 ms 等截图 + 写盘；可用 `--max-frames` 限制总数
- 视觉变化：默认录像不再带 cursor 飞点 / 打字机 / 波纹；这些是 agent 操作的
  "杜撰演绎"，纯录像应直接看真实 reddit 截图序列；想看效果传 `--effects=cursor`
  等开关

## [3.7.0] - 2026-05-03

### Added — DOM-first 重构（参考 `js-newidea-cli-test` 架构）

- **`--mode dom|api|auto` CLI flag**（`lib/commands.js` + `cli/index.js`）：
  - `dom` = 强制 DOM 路径（典型用于"录像优先"——前台肉眼可见的鼠标 / 输入 / 滚动 / 点击）
  - `api` = 强制 reddit JSON API 路径（兼容现有行为，CI / 批量 / 静默模式用）
  - `auto`（默认）= DOM 优先，遇 `dom_*` 失败码即 fallback 到 `api_*`，response 字段
    `mode` / `requestedMode` / `fallback` / `triedMethods` / `usedMethod` 全部回写，
    给上游审计留痕
- **`commands.js` metadata 三连**：每个 tool 命令加 `domSupported` / `apiSupported` /
  `defaultMode`，runTool 据此决定 `tryOrder = ['dom_<m>', 'api_<m>']` 或单跑某档
- **`runTool.js` dispatch 改造**：
  - 引入 `FALLBACK_ERRORS` 集合 — `dom_unstable` / `dom_timeout` / `dom_navigation_*` /
    `dom_extract_failed` / `dom_not_found` / `method_not_found` / `bridge_*`
  - **`dom_navigation_required` 协议**：DOM 桥发现当前页 URL 与目标不符时直接报这条
    错，runTool 先 `drainVisualEvents`（保住已 emit 的 `dom_navigate` / `dom_type`），
    再调对应 `navigate*` API 切页，等 bridge 重灌（`awaitBridgeAfterNav` +
    `ensureBridge`），最后**重试同一个 `dom_*` candidate**（最多 1 次）。
    这套协议解决了"页面跳转把 in-page ring buffer 清空"的事件丢失问题
  - 沿途 `concat` 累积所有 retry 段的事件，离线 timeline 看到完整动作流
- **6 桥 `dom_*` 实现 + `api_*` 前缀别名兼容层**：
  - `listing-bridge.js`：`dom_listSubreddit` + `dom_subredditAbout`
  - `search-bridge.js`：`dom_search`（含输入框逐字打字 / Enter 提交 / 等结果）
  - `post-bridge.js`：`dom_getPost`（评论树抽取）
  - `user-bridge.js`：`dom_userProfile`
  - `inbox-bridge.js`：`dom_inboxList`（含登录态短路）
  - `home-bridge.js`：`dom_myFeed` + `dom_sessionState`（半 DOM 化合并）
  - 每个桥末尾循环把所有非 `dom_*` / `api_*` / `__meta` 公开方法挂上 `api_<name>` 别名
- **`bridges/_dom-actions.js` 共享工具**（`@@include` 注入到 IIFE 闭包内）：
  - `__jseDomLocate` / `__jseDomWaitFor` / `__jseDomScrollIntoView` / `__jseDomClick` /
    `__jseDomType` / `__jseDomExtract` / `__jseDomEmitNavigateIntent`
  - 每步同步 `emit` `dom_*` 事件到 `__jse_visual` ring buffer（`drainVisualEvents`
    回收）
  - 鲁棒 selector fallback 链 + 可见性筛选 + Light DOM 优先（不进 shadow root）
- **`scripts/_dev-probe-dom.js` 健康度探针**：跑各 reddit 页关键 selector 链，
  输出 OK/FAIL 报告，selector 漂移时第一时间发现

### Verified — 6 桥单跑补测（v3.7.0 第二轮 PoC）

补完原 14 步深度调研覆盖盲区（post / user / inbox 三桥首次单跑）：

- **`get-post` 命令新增**：原 `post` 子命令走 v2 兼容入口（`runPostCommand → lib/api.js::getPost`），
  绕过 `runTool` dispatch，所以 `--mode dom|api|auto` 对它无效、`dom_getPost` 在
  CLI 层不可达。补加 `'get-post'` 作为 `kind:'tool'` 命令（`commands.js`），走
  `runToolCommand` 路径，CLI 层贯通；旧 `post` 入口零改动保留兼容。
  **PoC**：`get-post r/LocalLLaMA/comments/1sknx6n/...` `mode=dom fallback=false`
  7.5s 通过，含 `dom_navigate` 1 / `dom_wait` 2 / `dom_extract` 1 + 20 条评论
- **user / inbox 桥的 reputation captcha 早期检测**：reddit 对自动化的
  `/user/<name>/` 与 `/message/inbox/` 偶发插 reputation captcha
  （`shreddit-async-loader[bundlename="reputation_recaptcha"]`）；之前 dom 路径
  会白等 9s `wait_*` timeout 才 fallback。bridge 顶部加 1.5s 给页面初始化 + 直接
  `document.querySelector` 一次，命中即报 `dom_unstable {stage:"captcha_blocked"}`，
  让 runTool 立即 fallback。**user PoC**：18s → 4s（节省 14s）；**inbox PoC**：
  9s wait_inbox → 1.7s captcha_blocked
- **inbox 桥 dom-first 登录检测**：`dom_inboxList` 之前直接 `readMeViaApi(false)`，
  在 firefox 扩展 isolated world 里因 cookie partitioning 长期误报 `not_logged_in`
  （v3.6.1 已知 issue）。改为 `readLoginStateDom()` 优先 + API fallback——同
  `sessionStateCommon` 的两阶段策略；用户实际已登录时 dom 路径不再被 cookie
  partitioning 误杀
- **bridge VERSION 二次 bump**：user-bridge.js 3.6.0 → 3.6.1（DOM 登录 + captcha
  早期检测）；inbox-bridge.js 3.6.0 → 3.6.2（中间一次 bump 验证 ensureBridge
  热重注闭环——同会话内连续 bump 必须**每次都改**才会触发重注，光改源码不动
  VERSION 浏览器仍跑旧代码）
- **环境性限制（非 bridge bug）记录**：当前 firefox 会话下 reddit 对 `spez` 等
  admin profile 直接返 web 404、对所有 inbox 访问插 captcha + API 走匿名 →
  user / inbox 两桥都会 fallback 到 api，inbox 进一步会因为 API 也匿名而最终
  `not_logged_in`。这是 reddit 平台行为，dom-first 重构不解；fallback 链工作正确

### Verified — 14 步深度调研重录（runs/sess-ai-self-evolution-dom）

- 14 步全跑 `--mode auto`：12 步 DOM / 2 步 fallback API（fallback 比例 14% < 30%
  目标）
- 离线 events.jsonl 含：`dom_navigate` 10、`dom_type` 75、`dom_typed` 6、
  `dom_locate` 16、`dom_wait` 11、`dom_extract` 7、`flash` 99
- 重渲 composition：HUD 50 / cards 25 / data items 79 / flash 99
- 离线 cursor 轨迹连续可见，search 命令真有打字机效果（每字一帧 GSAP set value）

### Compatibility

- 老 session（API 模式 / 没有 `dom_*` 事件）重渲：`clips.dom` 全空，所有 dom 渲染
  分支 noop，行为完全等同 v3.6.3 / hyperframes v0.3.0（零回归）
- 旧无前缀方法名（`listSubreddit` / `search` 等）通过 `api_*` 别名继续工作，第三方
  调用方零改动

### Changed

- 6 桥 `VERSION` `3.5.4` → `3.6.0`（DOM-first 大变更）
- `package.json` 版本 `3.6.3` → `3.7.0`（minor：新增 `--mode` 与 DOM 路径，向后兼容）

## [3.6.3] - 2026-05-03

### Fixed

- **登录态下 reddit 录像 0 条 flash 事件**（v3.6.2 重录 sess-ai-self-evolution
  时观察到的 regression）：
  - 跑 `scripts/_dev-probe-anchor.js` 探针锁定**三**根因——
    - **主因 B（offVP）**：登录态 r/MachineLearning/hot 列表 6 个 t3_xxx 中 5 个
      首屏外（rect.top > viewport.height），`packages/visual-bridge-kit/bridge/
      visual.common.js::flashElement` 内的 `isInViewport` 检查 reject 不发 flash 事件
    - **次因 A（selector 过期）**：`bridges/_visual-reddit.js::resolvePost` 旧 fallback
      链 `article[data-test-id*="t3_..."]` 与 `a[data-click-id="body"][href*="/<id>/"]`
      在 shreddit 当前列表页 0 命中（实际 DOM 是 `article[data-post-id]` +
      `a[data-ks-id]`）。主匹配 `shreddit-post[id]` 还在工作，但要是 shreddit 又
      改版连 `shreddit-post` 也变了名字，fallback 就完全兜不住
    - **隐性根因 C（page 不导航 + setTimeout 节流）**：reddit-ops 大部分 READ 命令
      用 fetch 不做 location.assign，所以 `staggerFlashItems(items)` 在当前 tab 的
      DOM 上找搜索结果的 t3_xxx 是 0% 命中（DOM 上的 t3_ 是上次浏览的 sub，与搜索
      结果无交集）。即使命中了，stagger 用 90ms × N 间隔的 setTimeout 安排 emit，
      Firefox 后台 tab 把 setTimeout 节流到 1Hz，emit 几乎全漂到下次 drain 之后

- 修复（仅 `bridges/_visual-reddit.js`，不动 `@js-eyes/visual-bridge-kit`）：
  - `resolvePost` selector 链按"最稳 → 最容错"重排，新增 `article[data-post-id]` /
    `a[data-ks-id]` / `[data-fullname]` 三档现役 selector 在前，旧 legacy 退到链尾
  - `staggerFlashItems` 重写两阶段：
    - **阶段 1（同步语义 emit）**：for-loop 立刻把 N 条 `{type:'flash', anchor}`
      事件 push 进 ring buffer，drain 立即取走，**零 timing drift**——离线
      events.jsonl 的 flash 计数 100% 准确
    - **阶段 2（异步视觉 outline）**：N 个 setTimeout 仍按 stride 散布触发，里面
      调 `resolveAnchor` + scrollIntoView `{block:'center'}` + `flashElement` 画
      实际 outline；找不到 anchor / 在后台 tab / setTimeout 漂移都不影响事件流
  - 这条解耦实现 post-2.7.0 设计原则的最后一块：**"在线视觉效果"与"离线 composition
    事件流"完全独立**，前者依赖 DOM/viewport/tab focus，后者只依赖 anchor 的
    语义 id（`hyperframes` 在 composition 里通过 `data-anchor-id` 加 `.flash-active`
    动画，不需要在线 DOM 命中）
  - `resolveSubreddit` 把 `a[href="/r/<sub>"]` 精确匹配前置，旧 `shreddit-subreddit-icon[name]`
    退档（探针实测 community 主页才有，列表页 0 命中）

### Changed

- 6 个 bridge `VERSION` `3.5.2` → `3.5.4`（两次 bump：一次给 selector + scrollIntoView
  修复，一次给"emit 同步化"重写；触发热重注让正在跑的调用立即拿到最新逻辑）
- `package.json` 版本 `3.6.2` → `3.6.3`（patch：只修视觉录像 anchor 解析与事件流
  时序，不改业务 API / 不改 payload schema）
- 新增内部脚本 `scripts/_dev-probe-anchor.js`：登录态 selector / rect / shadow 探测
  报告（与 `_dev-probe-login.js` 同等级，仅本仓库开发者用，不进 skill.contract）

### Verified

- 重录 `runs/sess-ai-self-evolution-v3`（10 个 tool call，登录 firefox tab）：
  - flash 事件总数 **67**（v3.6.2 是 0，目标阈值 ≥ 30，**超额 2.2x**）
  - 每个 search/list-subreddit tool 各自落 8-12 条 flash（不再漂到下个 entry，
    一次性同步 emit 全部抢在 drain 前）
  - subreddit-about (kind=item) 0 flash 是预期（不调 stagger，only list/tree 调）
- `jse-replay --no-render` 输出 `flash clips: 67`，`templateUsage` 全部 `tier=exact`
  （PR 2 兜底也未触发——reddit 已注册全部 kind，零回归）
- 探针补跑：`shreddit-post[id="t3_..."]` 6/6 命中（5 offVP + 1 OK✓，列表内首屏
  外的 item 在 staggerFlashItems 阶段 2 由 scrollIntoView 兜住）；旧 fallback
  `article[data-test-id]` / `a[data-click-id]` 仍 0 命中（验证升级 fallback 链
  必要性）

### Known minor caveats

- Firefox 后台 tab 把阶段 2 的 setTimeout 节流到 1Hz，导致部分视觉 outline 漂移
  到事件触发后几十秒才画，会让 `replay-summary.json` 的 `durationSec` 被拉长
  （v3 实测 188s vs hud span 28s），但不影响每张卡的内容渲染 / 切换时机（cards
  按 before/after pair 在自己的窗口内播）。如要消除可在 firefox 端把 reddit tab
  保持前台，或改 visual-bridge-kit 的 flashElement 接受 silent opt（留作 minor）

### Notes

- `lib/visualHint.js` 不动（PR 1 / v3.6.2 已搞定 payload 提取）
- `packages/visual-bridge-kit/bridge/visual.common.js` 不动（探针验明 flashElement
  本身工作正常，问题在 anchor / viewport / 事件时序，全部在 reddit-ops 侧解决）

## [3.6.2] - 2026-05-03

### Fixed

- **`extractPayload(item)` 不识别 reddit-ops 二层 wrap，导致 `reddit_subreddit_about`
  的 visual 卡片几乎全空**：
  - `reddit_subreddit_about` bridge 实际返回结构是
    `{sub:'...', data:{displayName,subscribers,title,publicDescription,...}, meta:{...}}`，
    真字段藏在 `data.data` 这一层。
  - 旧版 `pickSingleItem` 只查 `data.item / data.post / data.about / data.subreddit
    / data.user / data.profile`，全部 miss → 走 fallback 到 `extractGlobalFields(data)`。
  - `extractGlobalFields` 扫 `Object.keys(data) = [sub, data, meta]`，`data` 与
    `meta` 因为是对象被跳过，只剩 `sub` 一条 kv 进 fields → 渲出来的 info-card
    只有 `sub=MachineLearning` 一条，看不到订阅数 / 标题 / 描述。
- 修复（仅改 `lib/visualHint.js`，bridge 不动）：
  - `pickSingleItem`：兜底分支增加 reddit-ops 二层 wrap 识别——`data.data` 是非数组
    对象时直接当真字段返回。
  - `extractGlobalFields`：把 `data.data` 当 primary 源平铺，扫两轮（primary 自己
    的字段 + data 顶层的 `sub` 等元字段）；`ordered` 关键字段表新增 reddit-ops
    bridge 实际产出的 camelCase 形态：`displayName / prefixed / activeUserCount /
    createdUtc / subredditType / publicDescription`。
  - `summary` 兜底链补 `primary.publicDescription`。

### Changed

- `package.json` 版本 `3.6.1` → `3.6.2`（patch：bug fix only）。
- bridge `VERSION` **不动**（修改全在 Node 端 `lib/visualHint.js`，浏览器端注入
  代码与登录态判定逻辑零变化）。

### Notes

- 视频侧配套：`@js-eyes/visual-replay-hyperframes` 同日 patch bump，给
  `templates/reddit/list.js` 加 sub-title `hint.label` 兜底（全站 search 卡片不再
  显示死值 `reddit`）；`templates/reddit/item.js::renderInfoCard` 加 hero metric
  区块，让 sub-about 这种带订阅数的信息卡有大字主指标。两边 patch 配合后，旧
  `runs/sess-ai-self-evolution` 重新跑一次录制 + `jse-replay` 重渲，sub-about 卡
  片会有实质内容。
- 老会话包仅重渲不会改善（`payload` 已写死在 `events.jsonl` 中），需要重录一次。

## [3.6.1] - 2026-05-03

### Fixed

- **firefox 上"已登录但 doctor 报 loggedIn:false"双爆 bug**：
  - **根因 A（环境层）**：firefox 扩展 isolated world 里的 `fetch('/api/v1/me.json',
    {credentials:'include'})` 经常被 reddit 当 anonymous 处理（cookie partitioning
    / 反扩展指纹），response status 200 但 body 只含 `features` 字段、没有 `name`
    / `data.name`，单走 API 路径会一致误判未登录。
  - **根因 B（DOM 选择器过时）**：shreddit 在 2025-2026 期间又改版，user drawer
    旧选择器 `faceplate-dropdown-menu[noun="user-drawer"]` /
    `faceplate-tracker[noun="user_drawer"]` 全部不再渲染，导致
    `bridges/common.js::readLoginStateDom` 一律返回 `source:'unknown'` 兜不住。
- 修复方式（最小集，仅改 `bridges/common.js`）：
  - `readLoginStateDom` 新增两段 shreddit 新版选择器（位于原选择器之前/之后）：
    - `community-author-flair[username] / achievements-entrypoint[username] /
      after-login-toast-dispatcher[username]` 任一命中即可拿到用户名，记
      `source: 'shreddit-username-attr'`；
    - `button#expand-user-drawer-button` 命中作为登录态硬信号兜底（拿不到 name），
      记 `source: 'shreddit-drawer-button'`。
  - `sessionStateCommon` 改 **DOM-first fast path**：DOM 命中直接返回登录态，再
    尽力跑一次 `readMeViaApi` 补 `totalKarma` / `modhash`（拿不到不阻断）；DOM
    未命中再走 API 后路。绕开根因 A，恢复 firefox 上 doctor / session-state 的
    正确判定。

### Changed

- 6 个 bridge `VERSION` 全部 `3.5.1` → `3.5.2`，`ensureBridge` 自动重注。
- `package.json` 版本 `3.6.0` → `3.6.1`（patch：bug fix only）。

### Notes

- 副作用：DOM fast path 命中时 `totalKarma` / `modhash` 仍尽力补，但 firefox 扩展
  上下文 fetch 被认 anonymous 时这两个字段会是 `null`。`modhash` 自 v3.2 起已无
  工具消费（INTERACTIVE 全走 `location.assign`），`totalKarma` 仅
  `reddit_session_state` 工具回（schema 已是 nullable），不影响下游。
- 真正修复根因 A（让扩展 fetch 实带 reddit_session HttpOnly cookie）需要扩展
  manifest + scripting API 改动，留待后续 minor。
- 内部踩点：新增 `scripts/_dev-probe-login.js`，定位 firefox 登录态判定问题用，
  与 `dom-dump` / `xhr-log` 同类，不暴露给 AI tool 列表。

## [3.6.0] - 2026-05-02

### Added

- 接入 `@js-eyes/visual-bridge-kit@^0.4.0`，解锁 Phase 2 录像能力：
  - `cli/index.js` 的 `runCallCommand` / `runNavigateCommand` / `runToolCommand`
    在 `--visual-record` 启用时构造 `captureFrame` 钩子（`makeFrameWriter`），
    通过 `session.bot.captureScreenshot` 拉当前激活 tab 的 PNG dataUrl，
    落到 `<recordDir>/frames/<ts>.png`。非激活 tab 静默 skip。
  - `lib/runTool.js` 把 kit 返回的 `frames` 元数据写到 trace entry 顶层，
    并调用 `attachFrameRefsToEvents` 把 frameRef 贴回到匹配的 events。
  - `lib/commands.js` 新增 `--redact-rect "x,y,w,h"` / `--redact-selector <css>`
    / `--redact-config <file.json>` 旋钮，`parseVisualFlags` 返回的
    `redact` 一路透传到 `appendVisualSession`，写入 `meta.json` 的
    `redact` 段，给离线 replay 端贴马赛克用。
- `lib/js-eyes-client.js` 新增 `captureScreenshot(tabId, options)` SDK 方法。

### Changed

- `package.json` 升 `@js-eyes/visual-bridge-kit` 到 `^0.4.0`，本 skill 版本 → 3.6.0。

### Notes

- 录像档位需要 chrome extension `@>=2.7.0`（新增 `capture_screenshot` RPC）；
  用户重新加载扩展后即可启用。
- bridge 端 `emit()` 现在自带 `viewport` 与 `anchor.rect`，旧消费者（仅看
  type/tone/label/action 的 cookbook / demo 脚本）零影响。

## [3.5.0] - 2026-05-02

### Added

- **页面内视觉反馈层**：接入新 workspace 包 `@js-eyes/visual-bridge-kit@0.1.0`，
  在调度边界（`lib/runTool.js` + `cli/index.js` 三个入口）自动给每个工具
  调用做 HUD + DOM-anchored flash + 列表呼吸感 + 评论树 relation 线，
  bridge 业务函数零侵入。
- 新增 7 个 CLI 旋钮：`--visual` / `--no-visual` / `--visual-detail
  compact|staged` / `--visual-ms <n>` / `--visual-mode auto|dom|hud|both|off` /
  `--visual-trace <jsonl>` / `--visual-list-stride <ms>` / `--visual-prefix
  <p>`。默认 `--visual --visual-mode auto --visual-detail staged`。
- 新增 `lib/visualHint.js`：18 个工具逐个声明 `visualHint`（`kind`/`label`/
  `anchor`/`target`/`detail`/`tone`），并实现 `buildSummary` 把 bridge 返回
  翻译成 list/tree 演出参数（前 8 个 `t3_*` flash + 父子 `t1_/t3_` relation 线）。
- 新增 `bridges/_visual-reddit.js`：reddit fullname (`t3_/t1_/t5_/t2_/t4_`) /
  CSS selector / reddit URL → DOM 锚点解析，支持 shreddit 与 old reddit 双
  前端，解析失败自动降级 HUD-only。同时提供 `staggerFlashItems` 给列表
  类工具用。
- `bridges/common.js` 顶部新增两条 `// @@include`：先装 `@js-eyes/visual-bridge-kit/bridge/visual.common.js`，再装 `_visual-reddit.js`。
- `lib/session.js`：`expandBridgeSource` 替换为 `@js-eyes/visual-bridge-kit`
  的 `makeBridgeExpander`（支持任意 `@@include`，含包路径 `@scope/pkg/...`）。
  `ensureBridge` 在每次握手末尾下发一次 `__jse_visual.config(...)`，前缀强制
  使用 `__jse_reddit_visual_` 避免与同浏览器内其它 skill 冲突。
- 安全护栏：z-index 取 `2147483000`（低于 reddit 自家 dialog），
  `pointer-events:none`，**不** `scrollIntoView`（虚拟滚动列表友好），
  ring buffer 上限 200，监听 `pushState`/`replaceState`/`popstate` 自动
  `cleanup()`。

### Changed

- `bridges/{home,post,listing,search,user,inbox}-bridge.js` 的 `VERSION`
  全部从 `3.4.1` → `3.5.0`，下次 `ensureBridge` 强制重注入。

### Notes

- 老用户回滚：加 `--no-visual` 完全等价于 3.4.x 行为。
- 接入指南：见 `packages/visual-bridge-kit/README.md` + `docs/dev/visual-cookbook.md`。

## [3.4.1] - 2026-04-26

Major architecture overhaul. The skill is now a full Reddit READ + INTERACTIVE
surface (still no DESTRUCTIVE), driven by `PAGE_PROFILES + Bridges + Session`.

### Added

- READ tools, all backed by Reddit's public JSON endpoints (same-origin cookie
  reuse) with `lib/redditUtils.js` cheerio fallback:
  - `reddit_session_state` — `/api/v1/me.json` first, DOM fallback; returns
    `{loggedIn, name, totalKarma, modhash}`.
  - `reddit_list_subreddit` — `/r/<sub>` listing with `sort`, `t`, `limit`,
    `after` paging.
  - `reddit_subreddit_about` — `/r/<sub>/about` metadata.
  - `reddit_search` — `/search` and `/r/<sub>/search` with `type`, `sub`,
    paging.
  - `reddit_user_profile` — `/user/<name>/<tab>` covering `overview /
    submitted / comments / saved / upvoted / downvoted / gilded / hidden`.
  - `reddit_inbox_list` — `/message/<box>` for `inbox / unread / messages /
    mentions / sent / moderator` (login required).
  - `reddit_my_feed` — `/`, `/r/popular`, `/r/all` with `sort=best/hot/new/
    top/rising`.
  - `reddit_expand_more` — flattens `_kind:'more'` nodes from
    `reddit_get_post` via `/api/morechildren`.
- INTERACTIVE tools (only mutate the browser's own URL, never click DOM CTAs):
  - `reddit_navigate_post`, `reddit_navigate_subreddit`,
    `reddit_navigate_search`, `reddit_navigate_user`,
    `reddit_navigate_inbox`, `reddit_navigate_home`. All implemented via
    `location.assign(newUrl)` with cross-origin URLs rejected at the bridge.
- Internal investigation CLIs (not exposed as AI tools):
  `node index.js dom-dump`, `node index.js xhr-log`. Pure read-only over the
  browser's existing buffers; no listeners, no hooks.
- `bridges/` directory with per-page-profile bridges (`home`, `inbox`,
  `listing`, `post`, `search`, `user`) plus a `common.js` bootstrap.
- `package.json#jsEyes.minParentVersion = "2.6.1"` so the registry no longer
  falls back to the parent's current version.

### Changed

- Architecture: switched from "single bridge per call" to
  `PAGE_PROFILES + Bridges + Session` (modeled after
  `js-wechat-mp-ops-skill`). Bridge injection happens once per session and
  later tool calls only invoke `window.__jse_reddit_*__.<method>()`.
- Frontend handling: `detectFrontend()` differentiates `shreddit` (new) from
  `old.reddit`. The JSON main path is frontend-agnostic; DOM parsing is the
  fallback only.
- Default tab behavior: READ tools default to
  `navigateOnReuse=false / reuseAnyRedditTab=true`, so the user's current tab
  is never hijacked.
- `reddit_get_post` now coexists with the new READ tools as a dedicated post
  detail entrypoint (title, body, author, score, images, comment tree with
  `depth/limit/sort`).
- Skill description / emoji / SKILL.md updated to reflect the new surface.

### Security

- Safety classification still only spans `READ` and `INTERACTIVE`. The skill
  explicitly refuses to vote, comment, post, edit, delete, save/unsave/hide/
  report, follow/subscribe/block, send/delete/mark messages, automate login,
  inject cookies, or forge `modhash` / bearer tokens. Any future move into
  `DESTRUCTIVE` will require `destructive: true` in `skill.contract.js` and
  explicit `--confirm` consent.
- Both sides must opt into raw eval for the one-time bridge bootstrap:
  - Host: `~/.js-eyes/config/config.json` `security.allowRawEval: true`.
  - Extension: js-eyes popup `Allow Raw Eval` enabled.
  - Otherwise the skill returns `RAW_EVAL_DISABLED`.

## [2.0.1] and earlier

Reddit post detail reader (`reddit_get_post` only). See git history for
details.

[3.4.1]: https://github.com/imjszhang/js-eyes/blob/main/skills/js-reddit-ops-skill/SKILL.md
