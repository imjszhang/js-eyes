# Changelog

All notable changes to `js-reddit-ops-skill` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this skill adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
