---
name: js-hn-ops-skill
description: Hacker News 只读 + 浏览器导航 skill：首页 / 帖子评论 / 用户 / Algolia 搜索走 Firebase API + DOM 兜底，浏览器侧仅 location.assign 改 URL。
version: 1.0.0
metadata:
  openclaw:
    emoji: "\U0001F4DD"
    homepage: https://github.com/imjszhang/js-eyes
    requires:
      skills:
        - js-eyes
      bins:
        - node
    platforms:
      - news.ycombinator.com
---

# js-hn-ops-skill

面向 [news.ycombinator.com](https://news.ycombinator.com/) 的**只读 + 仅改自身浏览器 URL** skill，架构对齐 `js-reddit-ops-skill` / `js-x-ops-skill`：

- **数据获取**：READ 优先走 Firebase 公开 API（`hacker-news.firebaseio.com/v0`）与 Algolia（`hn.algolia.com`）；DOM 解析为兜底
- **安全分级**：READ + INTERACTIVE 两档，**永不** DESTRUCTIVE（不投票 / 不评论 / 不 submit）

## 依赖与前置

- **JS Eyes Server** 已启动；浏览器扩展已连接
- **双侧 `allowRawEval`**（bridge 注入）
- 任意 `news.ycombinator.com` tab 即可；READ 默认不切走用户当前 tab

## AI 工具

| 档位 | 工具 | 说明 |
|------|------|------|
| READ | `hn_session_state` | 登录态 |
| READ | `hn_get_front_page` | 首页列表 `feed=top/new/best/ask/show/job` |
| READ | `hn_get_item` | 帖子 + 评论树 |
| READ | `hn_get_user` | 用户资料 + 列表 |
| READ | `hn_search` | Algolia 搜索 |
| INTERACTIVE | `hn_navigate_front` / `item` / `user` / `search` | 仅 `location.assign` |

## CLI

```bash
cd skills/js-hn-ops-skill && npm install

node index.js doctor
node index.js front --feed top --limit 10 --pretty
node index.js item 48526661 --depth 4
node index.js user subset --user-tab submitted --limit 20
node index.js search "LLM agent" --limit 10
node index.js navigate-item 48526661
```

## 启用

```bash
js-eyes skills link /path/to/js-eyes/skills/js-hn-ops-skill
js-eyes skills reload
```

## Page profiles

| profile | bridge |
|---------|--------|
| `front` | `__jse_hn_front__` |
| `item` | `__jse_hn_item__` |
| `user` | `__jse_hn_user__` |
| `search` | `__jse_hn_search__` |

## 内部踩点 CLI

| CLI | 用途 |
|-----|------|
| `node index.js dom-dump [--anchors]` | `.athing` / `.comtr` / `.fatitem` |
| `node index.js xhr-log [--filter]` | Firebase / Algolia 请求 |

## 明确不做

- 不 upvote / downvote / comment / submit
- 不做登录自动化
