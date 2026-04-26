# Changelog

All notable changes to `js-reddit-ops-skill` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this skill adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
